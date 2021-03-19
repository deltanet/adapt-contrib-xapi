define([
  'core/js/adapt',
  'core/js/enums/completionStateEnum',
  './utils',
  'libraries/async.min',
  'libraries/xapiwrapper.min',
  'libraries/url-polyfill.min'
], function(Adapt, COMPLETION_STATE, utilities, Async) {

    // Handler for xAPI wrapper library.

    var XapiFunctions = _.extend({

      /** Declare defaults and properties */

      // Default properties.
      statementLang: 'en-US',
      generateIds: false,
      activityId: null,
      actor: null,
      shouldTrackState:  true,
      shouldUseRegistration:  true,
      isInitialised:  false,
      state:  {},
      startAttemptDuration:  0,
      startTimeStamp:  null,
      courseName:  '',
      courseDescription:  '',
      defaultLang:  'en-US',
      isComplete:  false,

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

        // Initialize the xAPIWrapper.
        this.initializeWrapper(_.bind(function(error) {

          if (error) {
            this.onInitialised(error);
            return this;
          }

          this.activityId = (this.getLRSAttribute('activity_id') || this.getConfig('_activityID') || utilities.getBaseUrl());
          this.statementLang = this.getConfig('_lang');
          this.generateIds = this.getConfig('_generateIds');
          this.shouldTrackState = this.getConfig('_shouldTrackState') || true;
          this.shouldUseRegistration = this.getConfig('_shouldUseRegistration') || true;

          if (!this.validateProps()) {
            var error = new Error('Missing required properties');
            Adapt.log.error('adapt-contrib-xapi: xAPI Wrapper initialisation failed', error);
            this.onInitialised(error);
            return this;
          }

          this.startTimeStamp = new Date();


          if (!this.shouldTrackState) {
            // xAPI is not managing the state.
            this.onInitialised();
            return this;
          }

          // Retrieve the course state.
          this.getState(_.bind(function(error) {
            if (error) {
              console.error(error)
              this.onInitialised(error);
              return this;
            }

            this.onInitialised();
            return this;
          }, this));
        }, this));
      },


      initializeWrapper: function(callback) {
        // If no endpoint has been configured, assume the ADL Launch method.
        if (!this.getConfig('_endpoint')) {
          //check to see if configuration has been passed in URL
          this.xapiWrapper = window.xapiWrapper || ADL.XAPIWrapper;
          if (this.checkWrapperConfig()) {
            // URL had all necessary configuration so we continue using it.
            // Set the LRS specific properties.
            this.registration = this.getLRSAttribute('registration');
            this.actor = this.getLRSAttribute('actor');
            this.xapiWrapper.strictCallbacks = true;

            callback();
          } else {
            // If no endpoint is configured, assume this is using the ADL launch method.
            ADL.launch(_.bind(function(error, launchData, xapiWrapper) {
              if (error) {
                return callback(error);
              }

              // Initialise the xAPI wrapper.
              this.xapiWrapper = xapiWrapper;

              this.actor = launchData.actor

              this.xapiWrapper.strictCallbacks = true;

              callback();
            }, this), true, true);
          }
        } else {
          // The endpoint has been defined in the config, so use the static values.
          // Initialise the xAPI wrapper.
          this.xapiWrapper = window.xapiWrapper || ADL.XAPIWrapper;

          // Set any attributes on the xAPIWrapper.
          var configError;
          try {
            this.setWrapperConfig();
          } catch (error) {
            configError = error;
          }

          if (configError) {
            return callback(error);
          }

          // Set the LRS specific properties.
          this.registration = this.getLRSAttribute('registration');
          this.actor = this.getLRSAttribute('actor');

          this.xapiWrapper.strictCallbacks = true;

          callback();
        }
      },

      onInitialised: function(error) {
        this.isInitialised = !!!error;
        if (error) {
          // getState will be bypassed so set offlineStorage to ready
          Adapt.offlineStorage.setReadyStatus();
          Adapt.log.error('adapt-contrib-xapi: Initialisation error. ' + error);
        }

        _.defer(_.bind(function() {
          if (error) {
            Adapt.trigger('xapi:lrs:initialize:error', error);
            return;
          }

          Adapt.trigger('xapi:lrs:initialize:success');

          this.setupEventListeners();
        }, this));
      },

      setupEventListeners: function() {
        if (this.shouldTrackState) {
          this.listenTo(Adapt, 'state:change', this.sendState);
        }
      },

      /**
       * Attempt to extract endpoint, user and password from the config.json.
       */
      setWrapperConfig: function() {
        var keys = ['endpoint', 'user', 'password'];
        var newConfig = {};

        _.each(keys, function(key) {
          var val = this.getConfig('_' + key);

          if (val) {
            // Note: xAPI wrapper requires a trailing slash and protocol to be present
            if (key === 'endpoint') {
              val = val.replace(/\/?$/, '/');

              if (!/^https?:\/\//i.test(val)) {
                Adapt.log.warn('adapt-contrib-xapi: "_endpoint" value is missing protocol (defaulting to http://)');

                val = 'http://' + val;
              }
            }

            newConfig[key] = val;
          }
        }, this);

        if (!_.isEmpty(newConfig)) {
          this.xapiWrapper.changeConfig(newConfig);

          if (!this.xapiWrapper.testConfig()) {
            throw new Error('Incorrect xAPI configuration detected');
          }
        }
      },

      /**
      * Check Wrapper to see if all parameters needed are set.
      */
      checkWrapperConfig: function() {
        if (this.xapiWrapper.lrs.endpoint && this.xapiWrapper.lrs.actor
          && this.xapiWrapper.lrs.auth && this.xapiWrapper.lrs.activity_id ) {
            return true;
          } else {
            return false;
          }
      },

      getConfig: function(key) {
        if (!this.config || key === '' || typeof this.config[key] === 'undefined') {
          return false;
        }

        return this.config[key];
      },

      /**
       * Checks that the required properties -- actor and activityId -- are defined
       * @return {boolean} true if the properties are valid, false otherwise.
       */
      validateProps: function() {
        if (!this.actor || typeof this.actor !== 'object') {
          Adapt.log.warn('adapt-contrib-xapi: "actor" attribute not found!');
          return false;
        }

        if (!this.activityId) {
          Adapt.log.warn('adapt-contrib-xapi: "activityId" attribute not found!');
          return false;
        }

        return true;
      },

      /**
       * Sends multiple xAPI statements to the LRS.
       * @param {ADL.XAPIStatement[]} statements - An array of valid ADL.XAPIStatement objects.
       * @param {ErrorOnlyCallback} [callback]
       */
      sendStatements: function(statements, callback) {
        callback = _.isFunction(callback) ? callback : function() { };

        if (!statements || statements.length === 0) {
          return;
        }

        Adapt.trigger('xapi:preSendStatements', statements);

        // Rather than calling the wrapper's sendStatements() function, iterate
        // over each statement and call sendStatement().
        Async.each(statements, function(statement, nextStatement) {
          this.sendStatement(statement, nextStatement);
        }.bind(this), function(error) {
          if (error) {
            Adapt.log.error('adapt-contrib-xapi:', error);
            return callback(error);
          }

          callback();
        });
      },

      /**
       * Prepares to send a single xAPI statement to the LRS.
       * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
       * @param {ADLCallback} [callback]
       * @param {array} [attachments] - An array of attachments to pass to the LRS.
       */
      sendStatement: function(statement, callback, attachments) {
        callback = _.isFunction(callback) ? callback : function() { };

        if (!statement) {
          return;
        }

        Adapt.trigger('xapi:preSendStatement', statement);

        // Allow the trigger above to augment attachments if the attachments
        // parameter is not set.
        if (_.isUndefined(attachments) && statement.attachments) {
          return this.processAttachments(statement, callback);
        } else {
          this.onStatementReady(statement, callback, attachments);
        }
      },

      /**
       * Send an xAPI statement to the LRS once all async operations are complete
       * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
       * @param {ADLCallback} [callback]
       * @param {array} [attachments] - An array of attachments to pass to the LRS.
       */
      onStatementReady: function(statement, callback, attachments) {

        this.xapiWrapper.sendStatement(statement, function(error) {
          if (error) {
            Adapt.trigger('xapi:lrs:sendStatement:error', error);
            return callback(error);
          }

          Adapt.trigger('xapi:lrs:sendStatement:success', statement);
          return callback();
        }, attachments);
      },

      /**
       * Creates an xAPI statement related to the Adapt.course object.
       * @param {object | string} verb - A valid ADL.verbs object or key.
       * @param {object} [result] - An optional result object.
       * @return A valid ADL statement object.
       */
      getCourseStatement: function(verb, result) {
        if (typeof result === 'undefined') {
          result = {};
        }

        var object = this.getCourseActivity()

        // Append the duration.
        switch (verb) {
          case ADL.verbs.launched:
          case ADL.verbs.initialized:
          case ADL.verbs.attempted: {
            result.duration = 'PT0S';
            break;
          }

          case ADL.verbs.failed:
          case ADL.verbs.passed:
          case ADL.verbs.suspended: {
            result.duration = utilities.convertMillisecondsToISO8601Duration(this.getAttemptDuration());
            break;
          }

          case ADL.verbs.terminated: {
            result.duration = utilities.convertMillisecondsToISO8601Duration(this.getSessionDuration());
            break;
          }
        }

        return this.getStatement(this.getVerb(verb), object, result);
      },

      /**
       * Generate an XAPIstatement object for the xAPI wrapper sendStatement methods.
       * @param {object} verb - A valid ADL.verbs object.
       * @param {object} object -
       * @param {object} [result] - optional
       * @param {object} [context] - optional
       * @return {ADL.XAPIStatement} A formatted xAPI statement object.
       */
      getStatement: function(verb, object, result, context) {
        var statement = new ADL.XAPIStatement(
          new ADL.XAPIStatement.Agent(this.actor),
          verb,
          object
        );

        if (result && !_.isEmpty(result)) {
          statement.result = result;
        }

        if (context) {
          statement.context = context;
        }

        if (this._generateIds) {
          statement.generateId();
        }

        return statement;
      },

      /**
       * Gets an xAPI Activity (with an 'id of the activityId) representing the course.
       * @returns {ADL.XAPIStatement.Activity} Activity representing the course.
       */
      getCourseActivity: function() {
        var object = new ADL.XAPIStatement.Activity(this.activityId);
        var name = {};
        var description = {};
        var lang = Adapt.offlineStorage.get('lang');

        name[lang] = this.courseName;
        description[lang] = this.courseDescription;

        object.definition = {
          type: ADL.activityTypes.course,
          name: name,
          description: description
        };

        return object;
      },

      /**
       * Retrieve an LRS attribute for the current session, e.g. 'actor'.
       * @param {string} key - The attribute to fetch.
       * @return {object|null} the attribute value, or null if not found.
       */
      getLRSAttribute: function(key) {
        if (!this.xapiWrapper || !this.xapiWrapper.lrs || undefined === this.xapiWrapper.lrs[key]) {
          return null;
        }

        try {
          switch(key) {
            case 'actor': {
              var actor = JSON.parse(this.xapiWrapper.lrs[key]);

              if (_.isArray(actor.name)) {
                // Convert the name from an array to a string.
                actor.name = actor.name[0];
              }

              if (_.isArray(actor.mbox)) {
                // Convert mbox from an array to a string.
                actor.mbox = actor.mbox[0];
              }

              // If the account is an array, some work will be required.
              if (_.isArray(actor.account)) {
                var account = {};

                // Convert 'accountServiceHomePage' to 'homePage'.
                if (typeof actor.account[0].accountServiceHomePage !== 'undefined') {
                  account.homePage = actor.account[0].accountServiceHomePage;
                } else if (actor.account[0].homePage !== 'undefined') {
                  account.homePage = actor.account[0].homePage;
                }

                // Convert 'accountName' to 'name'.
                if (typeof actor.account[0].accountName !== 'undefined') {
                  account.name = actor.account[0].accountName;
                } else if (typeof actor.account[0].name !== 'undefined') {
                  account.name = actor.account[0].name;
                }

                // Out with the old array.
                delete actor.account;

                // In with the new object.
                actor.account = account;
              }

              return actor;
            }

            default:
              return this.xapiWrapper.lrs[key];
          }
        } catch (e) {
          return null;
        }
      },

      /**
       * Gets a valid 'verb' object in the ADL.verbs and returns the correct language version.
       * @param {object|stirng} verb - A valid ADL verb object or key, e.g. 'completed'.
       * @return {object} An ADL verb object with 'id' and language specific 'display' properties.
       */
      getVerb: function(verb) {
        if (typeof verb === 'string') {
          var key = verb.toLowerCase();
          verb = ADL.verbs[key];

          if (!verb) {
            Adapt.log.error('adapt-contrib-xapi: Verb "' + key + '" does not exist in ADL.verbs object');
          }
        }

        if (typeof verb !== 'object') {
          throw new Error('Unrecognised verb: ' + verb);
        }

        var lang = this.statementLang || this.defaultLang;

        var singleLanguageVerb = {
          id: verb.id,
          display: {}
        };

        var description = verb.display[lang];

        if (description) {
          singleLanguageVerb.display[lang] = description;
        } else {
          // Fallback in case the verb translation doesn't exist.
          singleLanguageVerb.display[this.defaultLang] = verb.display[this.defaultLang];
        }

        return singleLanguageVerb;
      },

      // Sends (optional) 'suspended' and 'terminated' statements to the LRS.
      sendUnloadStatements: function() {
        if (this.isTerminated || !this.isInitialised) {
          return;
        }

        var statements = [];

        if (!this.isComplete) {
          // If the course is still in progress, send the 'suspended' verb.
          statements.push(this.getCourseStatement(ADL.verbs.suspended));
        }

        // Always send the 'terminated' verb.
        statements.push(this.getCourseStatement(ADL.verbs.terminated));

        // Note: it is not possible to intercept these synchronous statements.
        this.sendStatementsSync(statements);

        this.isTerminated = true;
      },

      /**
       * Sends statements using the Fetch API in order to make use of the keepalive
       * feature not available in AJAX requests. This makes the sending of suspended
       * and terminated statements more reliable.
       */
      sendStatementsSync: function(statements) {
        var lrs = ADL.XAPIWrapper.lrs;

        // Fetch not supported in IE and keepalive/custom headers
        // not supported for CORS preflight requests so attempt
        // to send the statement in the usual way
        if (!window.fetch || utilities.isCORS(lrs.endpoint)) {
          return this.sendStatements(statements);
        }

        var url = lrs.endpoint + 'statements';
        var credentials = ADL.XAPIWrapper.withCredentials ? 'include' : 'omit';
        var headers = {
          'Content-Type': 'application/json',
          'Authorization': lrs.auth,
          'X-Experience-API-Version': ADL.XAPIWrapper.xapiVersion
        };

        // Add extended LMS-specified values to the URL
        var extended = _.map(lrs.extended, function(value, key) {
          return key + '=' + encodeURIComponent(value);
        });

        if (extended.length > 0) {
          url += (url.indexOf('?') > -1 ? '&' : '?') + extended.join('&');
        }

        fetch(url, {
          body: JSON.stringify(statements),
          cache: 'no-cache',
          credentials: credentials,
          headers: headers,
          mode: 'same-origin',
          keepalive: true,
          method: 'POST'
        }).then(function() {
          Adapt.trigger('xapi:lrs:sendStatement:success', statements);
        }).catch(function(error) {
          Adapt.trigger('xapi:lrs:sendStatement:error', error);
        })
      },

      // ######################################################
      // State functions

      /**
       * Retrieves the state information for the current course.
       * @param {ErrorOnlyCallback} [callback]
       */
      getState: function(callback) {
        callback = _.isFunction(callback) ? callback : function() { };

        var self = this;
        var activityId = this.activityId;
        var actor = this.actor;
        var registration = this.shouldUseRegistration === true
          ? this.registration
          : null;
        var state = {};

        Async.each(_.keys(this.coreObjects), function(type, nextType) {

          self.xapiWrapper.getState(activityId, actor, type, registration, null, function(error, xhr) {

            if (error) {
              Adapt.log.warn('adapt-contrib-xapi: getState() failed for ' + activityId + ' (' + type + ')');
              return nextType(error);
            }

            if (!xhr) {
              Adapt.log.warn('adapt-contrib-xapi: getState() failed for ' + activityId + ' (' + type + ')');
              return nextType(new Error('\'xhr\' parameter is missing from callback'));
            }

            if (xhr.status === 404) {
              return nextType();
            }

            if (xhr.status !== 200) {
              Adapt.log.warn('adapt-contrib-xapi: getState() failed for ' + activityId + ' (' + type + ')');
              return nextType(new Error('Invalid status code ' + xhr.status + ' returned from getState() call'));
            }

            var response;
            var parseError;

            // Check for empty response, otherwise the subsequent JSON.parse() will fail.
            if (xhr.response === '') {
              return nextType();
            }

            try {
              response = JSON.parse(xhr.response);
            } catch (e) {
              parseError = e;
            }

            if (parseError) {
              return nextType(parseError);
            }

            if (!_.isEmpty(response)) {
              state[type] = response;
            }

            return nextType();
          });
        }, function(error) {
          if (error) {
            Adapt.log.error('adapt-contrib-xapi:', error);
            Adapt.offlineStorage.setReadyStatus();
            return callback(error);
          }

          if (!_.isEmpty(state)) {
            self.state = state;
          }

          // restore offline storage on initialise, then rest of state once dataLoaded
          self.restoreOfflinestorage(_.bind(function(error) {
            if (error) {
              Adapt.offlineStorage.setReadyStatus();
              Adapt.trigger('xapi:lrs:initialize:error', error);
              callback(error);
            }
            Adapt.offlineStorage.setReadyStatus();
            Adapt.trigger('xapi:stateLoaded');
            callback();
          }, self));
        });
      },

      /**
       * Sends the state to the or the given model to the configured LRS.
       * @param {AdaptModel} model - The AdaptModel whose state has changed.
       */
      sendState: function(model, modelState) {

        if (!this.shouldTrackState) {
          return;
        }

        var activityId = this.activityId;
        var actor = this.actor;
        var type = model.get('_type');
        var state = this.state;
        var registration = this.shouldUseRegistration === true
          ? this.registration
          : null;
        var collectionName = _.findKey(this.coreObjects, function(o) {
          return o === type || o.indexOf(type) > -1
        });
        var stateCollection = _.isArray(state[collectionName]) ? state[collectionName] : [];
        var newState;

        if (collectionName !== 'course' && collectionName !== 'offlineStorage') {
          var index = _.findIndex(stateCollection, { _id: model.get('_id') });

          if (index !== -1) {
            stateCollection.splice(index, 1, modelState);
          } else {
            stateCollection.push(modelState);
          }

          newState = stateCollection;
        } else {
          newState = modelState;
        }

        // Update the locally held state.
        state[collectionName] = newState;
        this.state = state;

        // Pass the new state to the LRS.
        this.xapiWrapper.sendState(activityId, actor, collectionName, registration, newState, null, null, function(error, xhr) {
          if (error) {
            Adapt.trigger('xapi:lrs:sendState:error', error);
          }

          Adapt.trigger('xapi:lrs:sendState:success', newState);
        });
      },

      /**
       * Refresh offlineStorage from loaded state.
       */
      restoreOfflinestorage: function(callback) {
        if (_.isEmpty(this.state)) {
          return callback();
        }

        var Adapt = require('core/js/adapt');

        try {
          if (this.state.offlineStorage) {
            _.each(this.state.offlineStorage, function(value, key) {
              Adapt.offlineStorage.set(key, value);
            });
            callback();
          } else {
            callback('adapt-contrib-xapi: Unable to restore offline storage')
          }
        } catch(e) {
          callback(e)
        }
      },

      /**
       * Refresh course progress from loaded state.
       */
      restoreState: function(callback) {
        if (_.isEmpty(this.state)) {
          return callback();
        }

        var Adapt = require('core/js/adapt');

        try {
          if (this.state.components) {
            _.each(this.state.components, function(stateObject) {
              var restoreModel = Adapt.findById(stateObject._id);

              if (restoreModel) {
                restoreModel.setTrackableState(stateObject);
              } else {
                Adapt.log.warn('adapt-contrib-xapi: Unable to restore state for component: ' + stateObject._id);
              }
            });
          }

          if (this.state.blocks) {
            _.each(this.state.blocks, function(stateObject) {
              var restoreModel = Adapt.findById(stateObject._id);

              if (restoreModel) {
                restoreModel.setTrackableState(stateObject);
              } else {
                Adapt.log.warn('adapt-contrib-xapi: Unable to restore state for block: ' + stateObject._id);
              }
            });
          }
        } catch(e) {
          callback(e)
        }
      },

      /**
       * Deletes all state information for the current course.
       * @param {ErrorOnlyCallback} [callback]
       */
      deleteState: function(callback) {
        callback = _.isFunction(callback) ? callback : function() { };

        var self = this;
        var activityId = this.activityId;
        var actor = this.actor;
        var registration = this.shouldUseRegistration === true
          ? this.registration
          : null;

        Async.each(_.keys(this.coreObjects), function(type, nextType) {
          self.xapiWrapper.deleteState(activityId, actor, type, registration, null, null, function(error, xhr) {
            if (error) {
              Adapt.log.warn('adapt-contrib-xapi: deleteState() failed for ' + activityId + ' (' + type + ')');
              return nextType(error);
            }

            if (!xhr) {
              Adapt.log.warn('adapt-contrib-xapi: deleteState() failed for ' + activityId + ' (' + type + ')');
              return nextType(new Error('\'xhr\' parameter is missing from callback'));
            }

            if (xhr.status === 204 || xhr.status === 200) {
              return nextType();
            } else {
              Adapt.log.warn('adapt-contrib-xapi: deleteState() failed for ' + activityId + ' (' + type + ')');
              return nextType(new Error('Invalid status code ' + xhr.status + ' returned from getState() call'));
            }
          });
        }, function(error) {
          if (error) {
            Adapt.log.error('adapt-contrib-xapi:', error);
            return callback(error);
          }

          callback();
        });
      },

      /**
       * Process any attachments that have been added to the statement object by
       * intercepting the send operation at the xapi:preSendStatement trigger
       * If a url is specified for an attachment then retrieve the text content
       * and store this instead
       * @param {ADL.XAPIStatement} statement - A valid ADL.XAPIStatement object.
       * @param {ADLCallback} [callback]
       */
      processAttachments: function(statement, callback) {
        var attachments = statement.attachments;

        Async.each(attachments, function(attachment, nextAttachment) {

          // First check the attachment for a value
          if (attachment.value) {
            nextAttachment();
          } else if (attachment.url) {
            // If a url is specified then we need to obtain the string value
            // Use native xhr so we can set the responseType to 'blob'
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
              if (this.readyState === 4 && this.status === 200) {

                // Use FileReader to retrieve the blob contents as a string
                var reader = new FileReader();
                reader.onload = function() {

                  // Store the string value in the attachment object and
                  // delete the url property which is no longer needed
                  attachment.value = reader.result;
                  delete attachment.url;
                  nextAttachment()
                };
                reader.readAsBinaryString(this.response);
              }
            };
            xhr.open('GET', attachment.url);
            xhr.responseType = 'blob';
            xhr.send();
          } else {
            Adapt.log.warn('Attachment object contained neither a value or url property.');
          }
        }, function() {
          delete statement.attachments;
          this.onStatementReady(statement, callback, attachments);
        }.bind(this));
      },

      getActor: function() {
        if (_.isEmpty(this.actor)) {
          Adapt.log.warn('adapt-contrib-xapi: getActor() empty');
        }
        return this.actor;
      },

      getRegistration: function() {
        if (_.isEmpty(this.registration)) {
          Adapt.log.warn('adapt-contrib-xapi: getRegistration() empty');
        }
        return this.registration;
      },

      getActivityId: function() {
        if (_.isEmpty(this.activityId)) {
          Adapt.log.warn('adapt-contrib-xapi: getActivityId() empty');
        }
        return this.activityId;
      },

      getCurrentState: function(callback) {
        if (_.isEmpty(this.state)) {
          Adapt.log.warn('adapt-contrib-xapi: getCurrentState() empty');
        }
        return this.state;
      },

      isXapiInitialised: function(callback) {
        if (!this.isInitialised) {
          Adapt.log.warn('adapt-contrib-xapi: isXapiInitialised() returned false');
        }
        return this.isInitialised;
      },

      getAttemptDuration: function() {
        return this.startAttemptDuration + this.getSessionDuration();
      },

      getSessionDuration: function() {
        return Math.abs((new Date()) - this.startTimeStamp);
      }

    }, Backbone.Events);

    return XapiFunctions

});
