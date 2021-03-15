define([
    'core/js/adapt',
    './xapi',
    './adapt-stateful-session',
    './adapt-offlineStorage-xapi'
], function(Adapt, xapi, adaptStatefulSession) {

    //SCORM session manager

    var xAPIController = _.extend({

        _config: null,

    //Session Begin

        initialize: function() {
            this.listenToOnce(Adapt, {
                'offlineStorage:prepare': this.onPrepareOfflineStorage,
                'app:dataReady': function() {
                    Adapt.wait.for(adaptStatefulSession.initialize.bind(adaptStatefulSession));
                    //Adapt.wait.for(xapi.initialize.bind(xapi));
                }
            });
        },

        onPrepareOfflineStorage: function() {
            this._config = Adapt.config.get('_xapi') || false;

            if (!this._config || !this._config._isEnabled) {
                Adapt.offlineStorage.setReadyStatus();
                return;
            }
            console.log(xapi);
            xapi.initialize();

            /*
            force offlineStorage-scorm to initialise suspendDataStore - this allows us to do things like store the user's
            chosen language before the rest of the course data loads
            */
            Adapt.offlineStorage.get();

            Adapt.offlineStorage.setReadyStatus();

            this.setupEventListeners();
        },

        setupEventListeners: function() {
            var advancedSettings = this._config._advancedSettings;
            var shouldCommitOnVisibilityChange = (!advancedSettings ||
                advancedSettings._commitOnVisibilityChangeHidden !== false) &&
                document.addEventListener;

            this._onWindowUnload = this.onWindowUnload.bind(this);
            $(window).on('beforeunload unload', this._onWindowUnload);

            if (shouldCommitOnVisibilityChange) {
                document.addEventListener("visibilitychange", this.onVisibilityChange);
            }
        },

        removeEventListeners: function() {
            $(window).off('beforeunload unload', this._onWindowUnload);

            document.removeEventListener("visibilitychange", this.onVisibilityChange);
        },

        onVisibilityChange: function() {
          if (document.visibilityState === 'visible') {
            this.isTerminated = false;

            return xapi.sendStatement(xapi.getCourseStatement(ADL.verbs.resumed));
          }

          xapi.sendUnloadStatements();
        },

        //Session End

        onWindowUnload: function() {
            this.removeEventListeners();

            if (!scorm.finishCalled){
                scorm.finish();
            }
        }

    }, Backbone.Events);

    xAPIController.initialize();

});
