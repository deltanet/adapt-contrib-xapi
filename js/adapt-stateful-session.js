define([
  'core/js/adapt',
  'core/js/enums/completionStateEnum',
  './xapi',
  './utils',
  'libraries/async.min'
], function(Adapt, COMPLETION_STATE, xapi, utilities, Async) {

    // Implements Adapt session statefulness

    var AdaptStatefulSession = _.extend({

      // Default events to send statements for.
      coreEvents: {
        Adapt: {
          'router:page': false,
          'router:menu': false,
          'assessments:complete': true,
          'questionView:recordInteraction': true,
          "plugin:customStatement": true
        },
        contentObjects: {
          'change:_isComplete': false
        },
        articles: {
          'change:_isComplete': false
        },
        blocks: {
          'change:_isComplete': false
        },
        components: {
          'change:_isComplete': true
        }
      },

      // An object describing the core Adapt framework collections.
      coreObjects: {
        course: 'course',
        contentObjects: ['menu', 'page'],
        articles: 'article',
        blocks: 'block',
        components: 'component',
        offlineStorage: 'offlineStorage'
      },

      initialize: function() {
        if (!Adapt.config) {
          return;
        }

        this.config = Adapt.config.get('_xapi');

        if (!this.config || !this.config._isEnabled) {
          return this;
        }

        this.componentBlacklist = this.getConfig('_componentBlacklist') || [];

        if (this.componentBlacklist && !_.isArray(componentBlacklist)) {
          // Create the blacklist array and force the items to lowercase.
          this.componentBlacklist = this.componentBlacklist.split(/,\s?/).map(function(component) {
            return component.toLowerCase();
          });
        }
        this.getLearnerInfo();

        xapi.getState(_.bind(function(error) {
          if (error) {
            Adapt.log.warn('adapt-contrib-xapi: Unable to restore state, stateful session not initialised');
            return;
          }

          this.restoreState();
          _.defer(this.setupListeners.bind(this));
          //return this;
        }, this));
      },

      /**
       * Refresh course progress from loaded state.
       */
      // TODO - should this be moved to xapi to ensure it is initialised
      // as xapi initilisation is tied to Adapt.wait.for
      restoreState: function() {
        var state = xapi.getCurrentState();

        if (_.isEmpty(state)) {
          return;
        }

        var Adapt = require('core/js/adapt');

        if (state.components) {
          _.each(state.components, function(stateObject) {
            var restoreModel = Adapt.findById(stateObject._id);

            if (restoreModel) {
              restoreModel.setTrackableState(stateObject);
            } else {
              Adapt.log.warn('adapt-contrib-xapi: Unable to restore state for component: ' + stateObject._id);
            }
          });
        }

        if (state.blocks) {
          _.each(state.blocks, function(stateObject) {
            var restoreModel = Adapt.findById(stateObject._id);

            if (restoreModel) {
              restoreModel.setTrackableState(stateObject);
            } else {
              Adapt.log.warn('adapt-contrib-xapi: Unable to restore state for block: ' + stateObject._id);
            }
          });
        }
      },

      /**
       * Replace the hard-coded _learnerInfo data in _globals with the actual data from the LRS.
       */

      // TODO - check this function does anything necessary
      getLearnerInfo: function() {
        var globals = Adapt.course.get('_globals');

        if (!globals._learnerInfo) {
            globals._learnerInfo = {};
        }

        _.extend(globals._learnerInfo, Adapt.offlineStorage.get('learnerinfo'));
      },

      getConfig: function(key) {
        if (!this.config || key === '' || typeof this.config[key] === 'undefined') {
          return false;
        }

        return this.config[key];
      },

      // After initialisation state is controlled from these listeners
      setupListeners: function() {
        if (!xapi.isXapiInitialised()) {
          Adapt.log.warn('adapt-contrib-xapi: Unable to setup listeners for xAPI');
        }

        this.listenTo(Adapt, 'app:languageChanged', this.onLanguageChanged);

        if (this.getConfig('_shouldTrackState')) {
          this.listenTo(Adapt, 'state:change', xapi.sendState);  // TODO - deltanet, this should probably go in xapi.js
        }

        // Use the config to specify the core events.
        this.coreEvents = _.extend(this.coreEvents, this.getConfig('_coreEvents'));

        // Always listen out for course completion.
        this.listenTo(Adapt, 'tracking:complete', this.onTrackingComplete);

        // Conditionally listen to the events.
        // Visits to the menu.
        if (this.coreEvents['Adapt']['router:menu']) {
          this.listenTo(Adapt, 'router:menu', this.onItemExperience);
        }

        // Visits to a page.
        if (this.coreEvents['Adapt']['router:page']) {
          this.listenTo(Adapt, 'router:page', this.onItemExperience);
        }

        // When an interaction takes place on a question.
        if (this.coreEvents['Adapt']['questionView:recordInteraction']) {
          this.listenTo(Adapt, 'questionView:recordInteraction', this.onQuestionInteraction);
        }

        // When an assessment is completed.
        if (this.coreEvents['Adapt']['assessments:complete']) {
          this.listenTo(Adapt, 'assessments:complete', this.onAssessmentComplete);
        }

        // Listen out for custom statements.
        if (this.coreEvents['Adapt']['plugin:customStatement']) {
          this.listenTo(Adapt, 'plugin:customStatement', this.onCustomStatement);
        }

        // Standard completion events for the various collection types, i.e.
        // course, contentobjects, articles, blocks and components.
        _.each(_.keys(this.coreEvents), function(key) {
          if (key !== 'Adapt') {
            var val = this.coreEvents[key];

            if (typeof val === 'object' && val['change:_isComplete'] === true) {
              this.listenTo(Adapt[key], 'change:_isComplete', this.onItemComplete);
            }
          }
        }, this);
      },

      // ########################################
      // Event functions
      // TODO - add 'libraries/xapiwrapper.min', to this file or move all functions containing ADL to xapi.js

      onLanguageChanged: function(newLanguage) {
        // Update the language.
        //this.set({ displayLang: newLanguage });
        Adapt.offlineStorage.set('lang', newLanguage);

        // Since a language change counts as a new attempt, reset the state.
        xapi.deleteState(_.bind(function() {
          // Send a statement to track the (new) course.
          xapi.sendStatement(xapi.getCourseStatement(ADL.verbs.launched));
        }, this));
      },

      /**
       * Handler for the Adapt Framework's 'tracking:complete' event.
       * @param {object} completionData
       */
      onTrackingComplete: function(completionData) {
        var self = this;
        var result = {};
        var completionVerb;

        // Check the completion status.
        switch (completionData.status) {
          case COMPLETION_STATE.PASSED: {
            completionVerb = ADL.verbs.passed;
            break;
          }

          case COMPLETION_STATE.FAILED: {
            completionVerb = ADL.verbs.failed;
            break;
          }

          default: {
            completionVerb = ADL.verbs.completed;
          }
        }

        if (completionVerb === ADL.verbs.completed) {
          result = { completion: true };
        } else {
          // The assessment(s) play a part in completion, so use their result.
          result = this.getAssessmentResultObject(completionData.assessment);
        }

        // Store a reference that the course has actually been completed.
        this.isComplete = true;

        // log statement to LMS - bespoke debugging
        this.sendLogToLMS(xapi.getCourseStatement(completionVerb, result));

        _.defer(function() {
          // Send the completion status.
          xapi.sendStatement(xapi.getCourseStatement(completionVerb, result));
        });
      },

      /**
       * Sends an xAPI statement when an item has been experienced.
       * @param {AdaptModel} model - An instance of AdaptModel, i.e. ContentObjectModel, etc.
       */
      onItemExperience: function(model) {
        if (model.get('_id') === 'course') {
          // We don't really want to track actions on the home menu.
          return;
        }

        var object = new ADL.XAPIStatement.Activity(this.getUniqueIri(model));
        var statement;

        object.definition = {
          name: this.getNameObject(model),
          type: this.getActivityType(model)
        };

        // Experienced.
        statement = xapi.getStatement(xapi.getVerb(ADL.verbs.experienced), object);

        this.addGroupingActivity(model, statement)
        xapi.sendStatement(statement);
      },

      /**
       * Sends an 'answered' statement to the LRS.
       * @param {ComponentView} view - An instance of Adapt.ComponentView.
       */
      onQuestionInteraction: function(view) {
        if (!view.model || view.model.get('_type') !== 'component' && !view.model.get('_isQuestionType')) {
          return;
        }

        if (this.isComponentOnBlacklist(view.model.get('_component'))) {
          // This component is on the blacklist, so do not send a statement.
          return;
        }

        var object = new ADL.XAPIStatement.Activity(this.getUniqueIri(view.model));
        var isComplete = view.model.get('_isComplete');
        var lang = Adapt.offlineStorage.get('lang');
        var statement;
        var description = {};

        description[lang] = utilities.stripHtml(view.model.get('body'));

        object.definition = {
          name: this.getNameObject(view.model),
          description: description,
          type: ADL.activityTypes.question,
          interactionType: view.getResponseType()
        };

        if (typeof view.getInteractionObject === 'function') {
          // Get any extra interactions.
          _.extend(object.definition, view.getInteractionObject());

          // Ensure any 'description' properties are objects with the language map.
          _.each(_.keys(object.definition), function(key) {
            if (_.isArray(object.definition[key]) && object.definition[key].length !== 0) {
              for (var i = 0; i < object.definition[key].length; i++) {
                if (!object.definition[key][i].hasOwnProperty('description')) {
                  break;
                }

                if (typeof object.definition[key][i].description === 'string') {
                  var description = {};
                  description[lang] = object.definition[key][i].description;

                  object.definition[key][i].description = description;
                }
              }
            }
          });
        }

        var result = {
          score: {
            raw: view.model.get('_score') || 0
          },
          success: view.model.get('_isCorrect'),
          completion: isComplete,
          response: utilities.processInteractionResponse(object.definition.interactionType, view.getResponse())
        };

        // Answered
        statement = xapi.getStatement(xapi.getVerb(ADL.verbs.answered), object, result);

        this.addGroupingActivity(view.model, statement)
        xapi.sendStatement(statement);
      },

      /**
       * Sends an xAPI statement when an assessment has been completed.
       * @param {object} assessment - Object representing the state of the assessment.
       */
      onAssessmentComplete: function(assessment) {
        var object = this.getAssessmentObject(assessment)
        var result = this.getAssessmentResultObject(assessment);
        var statement;

        if (assessment.isPass) {
          // Passed.
          statement = xapi.getStatement(xapi.getVerb(ADL.verbs.passed), object, result);
        } else {
          // Failed.
          statement = xapi.getStatement(xapi.getVerb(ADL.verbs.failed), object, result);
        }

        statement.addGroupingActivity(xapi.getCourseActivity())
        statement.addGroupingActivity(this.getLessonActivity(assessment.pageId))

        // log statement to LMS - bespoke debugging
        this.sendLogToLMS(statement);

        // Delay so that component completion can be recorded before assessment completion.
        _.delay(function() {
          xapi.sendStatement(statement);
        }, 500);
      },

      /**
       * Sends an xAPI statement when an item has been completed.
       * @param {AdaptModel} model - An instance of AdaptModel, i.e. ComponentModel, BlockModel, etc.
       * @param {boolean} isComplete - Flag to indicate if the model has been completed
       */
      onItemComplete: function(model, isComplete) {
        if (isComplete === false) {
          // The item is not actually completed, e.g. it may have been reset.
          return;
        }

        // If this is a question component (interaction), do not record multiple statements.
        if (model.get('_type') === 'component' && model.get('_isQuestionType') === true
          && this.coreEvents['Adapt']['questionView:recordInteraction'] === true
          && this.coreEvents['components']['change:_isComplete'] === true) {
          // Return because 'Answered' will already have been passed.
          return;
        }

        if (model.get('_type') === 'component' && this.isComponentOnBlacklist(model.get('_component'))) {
          // This component is on the blacklist, so do not send a statement.
          return;
        }

        var result = { completion: true };
        var object = new ADL.XAPIStatement.Activity(this.getUniqueIri(model));
        var statement;

        object.definition = {
          name: this.getNameObject(model),
          type: this.getActivityType(model)
        };

        // Completed.
        statement = xapi.getStatement(xapi.getVerb(ADL.verbs.completed), object, result);

        this.addGroupingActivity(model, statement)
        xapi.sendStatement(statement);
      },

      /**
      * Sends an xAPI statement when plugin triggers a custom statement.
      * @param {AdaptModel} model - An instance of AdaptModel, i.e. ContentObjectModel, etc.
      */

      onCustomStatement: function(statementModel) {
        var customResult = {};
        var customContext = {};
        // get the verb
        var statement;
        var customVerb = ADL.verbs[statementModel.get('verb')];

        // get the object
        var customIri = '';
        if (statementModel.get('generateIri')) {
          customIri = this.getUniqueIri(statementModel);
        } else {
          customIri = statementModel.get('_id');
        }
        var object = new ADL.XAPIStatement.Activity(customIri);
        object.definition = {
          name: this.getNameObject(statementModel),
          type: this.getActivityType(statementModel)
        };

        // get result
        // TODO

        // get custom context
        // TODO

        statement = xapi.getStatement(xapi.getVerb(customVerb), object, customResult, customContext);

        // add parent activity if part of assessment
        if (statementModel && statementModel.get('_isPartOfAssessment')) {
          var assessment = statementModel.assessment;
          if (typeof assessment === 'object') {
            statement.addParentActivity(this.getAssessmentObject(assessment));
          }
        }

        this.addGroupingActivity(statementModel, statement)
        xapi.sendStatement(statement);
      },

      // ########################################
      // Utility functions for on event functions
      // TODO - move these to utils.js if possible

      /**
       * Takes an assessment state and returns a results object based on it.
       * @param {object} assessment - An instance of the assessment state.
       * @return {object} - A result object containing score, success and completion properties.
       */
      getAssessmentResultObject: function(assessment) {
        var result = {
          score: {
            scaled: (assessment.scoreAsPercent / 100),
            raw: assessment.score,
            min: 0,
            max: assessment.maxScore
          },
          success: assessment.isPass,
          completion: assessment.isComplete
        };

        return result;
      },

      /**
       * Gets a unique IRI for a given model.
       * @param {AdaptModel} model - An instance of an AdaptModel object.
       * @return {string} An IRI formulated specific to the passed model.
       */
      getUniqueIri: function(model) {
        var iri = xapi.getActivityId();
        var type = model.get('_type');

        if (type !== 'course') {
          if (type === 'article-assessment') {
            iri = iri + ['#', 'assessment', model.get('_id')].join('/');
          } else {
            iri = iri + ['#/id', model.get('_id')].join('/');
          }
        }

        return iri;
      },

      /**
       * Gets a name object from a given model.
       * @param {Backbone.Model} model - An instance of Adapt.Model (or Backbone.Model).
       * @return {object} An object containing a key-value pair with the language code and name.
       */
      getNameObject: function(model) {
        var name = {};

        name[Adapt.offlineStorage.get('lang')] = model.get('displayTitle') || model.get('title');

        return name;
      },

      /**
       * Gets the activity type for a given model.
       * @param {Backbone.Model} model - An instance of Adapt.Model (or Backbone.Model).
       * @return {string} A URL to the current activity type.
       */
      getActivityType: function(model) {
        var type = '';

        switch (model.get('_type')) {
          case 'component': {
            type = model.get('_isQuestionType') ? ADL.activityTypes.interaction : ADL.activityTypes.media;
            break;
          }
          case 'block':
          case 'article': {
            type = ADL.activityTypes.interaction; //??
            break;
          }
          case 'course': {
            type = ADL.activityTypes.course;
            break;
          }
          case 'menu': {
            type = ADL.activityTypes.module;
            break;
          }
          case 'page': {
            type = ADL.activityTypes.lesson;
            break;
          }
          default: {
            type = ADL.activityTypes[model.get('_type')];
            break;
          }
        }

        return type;
      },

      /**
       * Adds a 'grouping' and/or 'parent' value to a statement's contextActivities.
       * Note: the 'parent' is only added in the case of a question component which is part of
       * an assessment. All articles, blocks and components are grouped by page.
       * @param {Adapt.Model} model - Any Adapt model.
       * @param {ADL.XAPIStatement} statement - A valid xAPI statement object.
       */
      addGroupingActivity: function(model, statement) {
        var type = model.get('_type');

        if (type !== 'course') {
          // Add a grouping for the course.
          statement.addGroupingActivity(xapi.getCourseActivity())
        }

        if (['article', 'block', 'component'].indexOf(type) !== -1) {
          // Group these items by page/lesson.
          var pageModel = model.findAncestor('pages')

          statement.addGroupingActivity(this.getLessonActivity(pageModel));
        }

        if (type === 'component' && model.get('_isPartOfAssessment')) {
          // Get the article containing this question component.
          let articleModel = model.findAncestor('articles')

          if (articleModel && articleModel.has('_assessment') && articleModel.get('_assessment')._isEnabled) {
            // Set the assessment as the parent.
            var assessment = {
              id: articleModel.get('_assessment')._id,
              articleId: articleModel.get('_id'),
              type: 'article-assessment',
              pageId: articleModel.get('_parentId')
            }

            statement.addParentActivity(this.getAssessmentObject(assessment))
          }
        }
      },

      /**
       * Gets an Activity for use in an xAPI statement.
       * @param {object} assessment - Object representing the assessment.
       * @returns {ADL.XAPIStatement.Activity} - Activity representing the assessment.
       */
      getAssessmentObject: function(assessment) {
        // Instantiate a Model so it can be used to obtain an IRI.
        var fakeModel = new Backbone.Model({
          _id: assessment.id || assessment.articleId,
          _type: assessment.type,
          pageId: assessment.pageId
        });

        var object = new ADL.XAPIStatement.Activity(this.getUniqueIri(fakeModel));
        var name = {};

        name[Adapt.offlineStorage.get('lang')] = assessment.id || 'Assessment';

        object.definition = {
          name: name,
          type: ADL.activityTypes.assessment
        };

        return object
      },

      /**
       * Gets a lesson activity for a given page.
       * @param {string|Adapt.Model} page - Either an Adapt contentObject model of type 'page', or the _id of one.
       * @returns {XAPIStatement.Activity} Activity corresponding to the lesson.
       */
      getLessonActivity: function(page) {
        var pageModel = (typeof page === 'string')
          ? Adapt.findById(page)
          : page
        var activity = new ADL.XAPIStatement.Activity(this.getUniqueIri(pageModel))
        var name = this.getNameObject(pageModel)

        activity.definition = {
          name: name,
          type: ADL.activityTypes.lesson
        }

        return activity;
      },

      /**
       * Checks if a given component is blacklisted from sending statements.
       * @param {string} component - The name of the component.
       * @returns {boolean} true if the component exists on the blacklist.
       */
      isComponentOnBlacklist: function(component) {
        return this.componentBlacklist.indexOf(component) !== -1;
      },

      /**
       * Sends a statement and registration ID to logging function in LMS.
       * @param {ADL.XAPIStatement[]} statements - An array of valid ADL.XAPIStatement objects.
       */
      sendLogToLMS: function(statement) {
        var registration = xapi.getRegistration() || null;
        try {
          window.opener.sendStatementToLMS(registration, statement);
          console.log('adapt-contrib-xapi: Statement sent to LMS logger.');
        } catch (error) {
          console.error('adapt-contrib-xapi: Error sending statement to LMS logger: ' + error);
        }
      }
    }, Backbone.Events);

    return AdaptStatefulSession;

});
