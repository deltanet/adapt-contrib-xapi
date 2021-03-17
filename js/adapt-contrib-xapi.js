define([
    'core/js/adapt',
    './xapi',
    './adapt-stateful-session',
    './adapt-offlineStorage-xapi',
    'libraries/xapiwrapper.min'
], function(Adapt, xapi, adaptStatefulSession) {

    var xAPIController = _.extend({

        _config: null,

        //Session Begin

        initialize: function() {
            this.listenToOnce(Adapt, {
                'offlineStorage:prepare': this.onPrepareOfflineStorage,
                'app:dataReady': function() {
                    Adapt.wait.for(adaptStatefulSession.initialize.bind(adaptStatefulSession));
                    Adapt.wait.for(xapi.restoreState.bind(xapi));
                }
            });
        },

        onPrepareOfflineStorage: function() {
            this._config = Adapt.config.get('_xapi') || false;

            if (!this._config || !this._config._isEnabled) {
                Adapt.offlineStorage.setReadyStatus();
                return;
            }

            xapi.initialize();

            /*
            force offlineStorage-scorm to initialise suspendDataStore - this allows us to do things like store the user's
            chosen language before the rest of the course data loads
            */
            Adapt.offlineStorage.get();

            this.setupEventListeners();
        },

        setupEventListeners: function() {
            if (['ios', 'android'].indexOf(Adapt.device.OS) > -1) {
              $(document).on('visibilitychange', this.onVisibilityChange.bind(this));
            } else {
              $(window).on('beforeunload unload', xapi.sendUnloadStatements.bind(this));
            }
        },

        /**
         * Sends 'suspended' and 'terminated' statements to the LRS when the window
         * is closed or the browser app is minimised on a device. Sends a 'resume'
         * statement when switching back to a suspended session.
         */
        onVisibilityChange: function() {
          if (document.visibilityState === 'visible') {
            this.isTerminated = false;

            return xapi.sendStatement(xapi.getCourseStatement(ADL.verbs.resumed));
          }

          xapi.sendUnloadStatements();
        }

    }, Backbone.Events);

    xAPIController.initialize();

});
