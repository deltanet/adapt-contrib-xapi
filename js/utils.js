define([
    'core/js/adapt'
], function(Adapt){

  var utilities = {

    /**
     * Determine if sending the statement involves a Cross Origin Request
     * @param {string} url - the lrs endpoint
     * @returns {boolean}
     */
    isCORS: function(url) {
      var urlparts = url.toLowerCase().match(/^(.+):\/\/([^:\/]*):?(\d+)?(\/.*)?$/);
      var isCORS = (location.protocol.toLowerCase().replace(':', '') !== urlparts[1] || location.hostname.toLowerCase() !== urlparts[2]);
      if (!isCORS) {
        var urlPort = (urlparts[3] === null ? (urlparts[1] === 'http' ? '80' : '443') : urlparts[3]);
        isCORS = (urlPort === location.port);
      }

      return isCORS;
    },

    getGlobals: function() {
      return _.defaults(
        (
          Adapt &&
          Adapt.course &&
          Adapt.course.get('_globals') &&
          Adapt.course.get('_globals')._extensions &&
          Adapt.course.get('_globals')._extensions._xapi
        ) || {},
        {
          'confirm': 'OK',
          'lrsConnectionErrorTitle': 'LRS not available',
          'lrsConnectionErrorMessage': 'We were unable to connect to your Learning Record Store (LRS). This means that your progress cannot be recorded.'
        }
      );
    },

    /**
     * Gets the URL the course is currently running on.
     * @return {string} The URL to the current course.
     */
    getBaseUrl: function() {
      var url = window.location.origin + window.location.pathname;

      Adapt.log.info('adapt-contrib-xapi: Using detected URL (' + url + ') as ActivityID');

      return url;
    },

    showError: function() {
      var config = Adapt.config.get('_xapi');
      if (config && config._lrsFailureBehaviour === 'ignore') {
        return;
      }

      var notifyObject = {
        title: this.getGlobals().lrsConnectionErrorTitle,
        body: this.getGlobals().lrsConnectionErrorMessage,
        confirmText: this.getGlobals().confirm
      };

      // Setup wait so that notify does not get dismissed when the page loads
      Adapt.wait.begin();
      Adapt.trigger('notify:alert', notifyObject);
      // Ensure notify appears on top of the loading screen
      $('.notify').css({ position: 'relative', zIndex: 5001 });
      Adapt.once('notify:closed', Adapt.wait.end);
    },

    /**
     * Converts milliseconds to an ISO8601 duration
     * @param {int} inputMilliseconds - Duration in milliseconds
     * @return {string} - Duration in ISO8601 format
     */
    convertMillisecondsToISO8601Duration: function(inputMilliseconds) {
      var hours;
      var minutes;
      var seconds;
      var i_inputMilliseconds = parseInt(inputMilliseconds, 10);
      var i_inputCentiseconds;
      var inputIsNegative = '';
      var rtnStr = '';

      // Round to nearest 0.01 seconds.
      i_inputCentiseconds = Math.round(i_inputMilliseconds / 10);

      if (i_inputCentiseconds < 0) {
        inputIsNegative = '-';
        i_inputCentiseconds = i_inputCentiseconds * -1;
      }

      hours = parseInt(((i_inputCentiseconds) / 360000), 10);
      minutes = parseInt((((i_inputCentiseconds) % 360000) / 6000), 10);
      seconds = (((i_inputCentiseconds) % 360000) % 6000) / 100;

      rtnStr = inputIsNegative + 'PT';
      if (hours > 0) {
        rtnStr += hours + 'H';
      }

      if (minutes > 0) {
        rtnStr += minutes + 'M';
      }

      rtnStr += seconds + 'S';

      return rtnStr;
    },

    /**
     * Removes the HTML tags/attributes and returns a string.
     * @param {string} html - A string containing HTML
     * @returns {string} The same string minus HTML
     */
    stripHtml: function(html) {
      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;

      return tempDiv.textContent || tempDiv.innerText || '';
    },

    /**
     * In order to support SCORM 1.2 and SCORM 2004, some of the components return a non-standard
     * response.
     * @param {string} responseType - The type of the response.
     * @param {string} response - The unprocessed response string.
     * @returns {string} A response formatted for xAPI compatibility.
     */
    processInteractionResponse: function(responseType, response) {
      switch (responseType) {
        case 'choice': {
          response = response.replace(/,|#/g, '[,]');

          break;
        }
        case 'matching': {
          // Example: 1[.]1_1[,]2[.]2_5
          response = response
            .split('#')
            .map(function(val, i) {
              return (i + 1) + '[.]' + val.replace('.', '_')
            })
            .join('[,]');
          break;
        }
      }

      return response;
    },

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
    }
  }

  return utilities;

});
