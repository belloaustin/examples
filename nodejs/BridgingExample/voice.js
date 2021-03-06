/**
 * voice.js
 *
 * A simple express app to demonstrate usage of Bandwidth's Voice API and callbacks
 *
 * @copyright Bandwidth INC
 */

const BandwidthVoice = require('@bandwidth/voice');
const BandwidthBxml = require('@bandwidth/bxml');
const url = require('url');
const config = require('./config');
const FORWARD_TO = config.PERSONAL_NUMBER;

BandwidthVoice.Configuration.basicAuthUserName = config.BANDWIDTH_API_USERNAME;
BandwidthVoice.Configuration.basicAuthPassword = config.BANDWIDTH_API_PASSWORD;
const voiceController = BandwidthVoice.APIController;


/**
 * A method for showing how to handle inbound Bandwidth voice callbacks.
 * Plays a lot of ringing
 *
 * @return {string} The generated BXML
 */
exports.handleInboundCall = async (req, res) => {
  const event = req.body;

  const speakSentence = new BandwidthBxml.Verbs.SpeakSentence();
  speakSentence.setSentence("Connecting your call, please wait");
  speakSentence.setVoice("julie");

  const response = new BandwidthBxml.Response();
  response.addVerb(speakSentence);

  const ring = new BandwidthBxml.Verbs.Ring();
  ring.setDuration(20)

  const redirect = new BandwidthBxml.Verbs.Redirect();
  redirect.setRedirectUrl(new URL('/UpdateCall', config.BASE_URL).href);

  response.addVerb(ring);
  response.addVerb(redirect);    // if something unexpected happens with the B-leg, the redirect will trigger and send the A-leg to voicemail

  const bxml = response.toBxml();
  res.send(bxml);
  await createOutboundCall(FORWARD_TO, event.from, event.callId);
};


/**
 * Create the outbound call to our users personal number
 */
 const createOutboundCall = async (to, from, callIdA) => {
   const answerUrl = (new URL('/Outbound/Answer', config.BASE_URL)).href;
   const body = {
     from: from,
     to: to,
     applicationId: config.BANDWIDTH_VOICE_APPLICATION_ID,
     answerUrl: answerUrl,
     answerMethod: "POST",
     callTimeout: 15,    // end the call before it goes to voicemail
     tag: callIdA,
     disconnectUrl: (new URL('/Disconnect', config.BASE_URL)).href,
     disconnectMethod: "POST"
   }
   const callRequest = new BandwidthVoice.ApiCreateCallRequest(body);
   try {
     const response = await voiceController.createCall(config.BANDWIDTH_ACCOUNT_ID, callRequest);
     return response;
   }
   catch (error) {
     console.log('Error creating outbound call Request');
     console.log(body);
     console.log(error);
   }
 }


/**
 * Handle the users response to the B-leg call
 *
 * @return {string} The generated BXML
 */
exports.handleOutboundCall = (req, res) => {
  const event = req.body;
  const tag = event.tag;    // callIdA
  if (event.eventType !== 'answer') {
    try {
        // update A-leg of call to start recording
        var body = new BandwidthVoice.ApiModifyCallRequest({
        "redirectUrl": (new URL('/UpdateCall', config.BASE_URL)).href,
        "state": "active",
        "redirectMethod": "POST"
        });
        voiceController.modifyCall(config.BANDWIDTH_ACCOUNT_ID, tag, body);
    } catch (error) {
        console.error(error);
      }
    } else {
        const speakSentence = new BandwidthBxml.Verbs.SpeakSentence();
        speakSentence.setSentence("Please press 1 to accept the call, or any other button to send to voicemail");
        speakSentence.setVoice("kate");

        const gather = new BandwidthBxml.Verbs.Gather();
        gather.setGatherUrl("/Outbound/Gather");
        gather.setTerminatingDigits("#");
        gather.setMaxDigits("1");
        gather.setFirstDigitTimeout(10);
        gather.setSpeakSentence(speakSentence);
        gather.setTag(tag);

        const response = new BandwidthBxml.Response();
        response.addVerb(gather);
        const bxml = response.toBxml();
        res.send(bxml);
  }
}


/**
 * Read the digits from the gather performed on the B-leg
 *
 * @return {string} The generated BXML
 */
exports.handleOutboundGather = (req, res) => {
  const event = req.body;
  const tag = event.tag;
  if (event.digits !== '1') {
    var body = new BandwidthVoice.ApiModifyCallRequest({
    "redirectUrl": (new URL('/UpdateCall', config.BASE_URL)).href,
    "state": "active",
    "redirectMethod": "POST"
    });
    try {
        var speakSentence = new BandwidthBxml.Verbs.SpeakSentence();
        speakSentence.setSentence('We will send the caller to voicemail.');
        speakSentence.setVoice("julie");

        var hangup = new BandwidthBxml.Verbs.Hangup();

        var response = new BandwidthBxml.Response();
        response.addVerb(speakSentence);
        response.addVerb(hangup);

        const bxml = response.toBxml();
        res.send(bxml);
        voiceController.modifyCall(config.BANDWIDTH_ACCOUNT_ID, tag, body);
    } catch (error) {
        console.error(error);
    }
  } else {
      const speakSentence = new BandwidthBxml.Verbs.SpeakSentence();
      speakSentence.setSentence("The bridge will start now");
      speakSentence.setVoice("julie");
      const bridge = new BandwidthBxml.Verbs.Bridge();
      bridge.setCallId(tag);

      const response = new BandwidthBxml.Response();
      response.addVerb(speakSentence);
      response.addVerb(bridge);

      const bxml = response.toBxml();
      res.send(bxml);
 }
}


/**
 * Redirect the A-leg of the call to new BXML if a disconnect event is recieved
 */
exports.handleDisconnect = async (req, res) => {
  const event = req.body;
  const tag = event.tag;    // the Call ID of the original inbound call
  // console.log(event)
  if(event.cause == 'timeout'){
    var body = new BandwidthVoice.ApiModifyCallRequest({
    "redirectUrl": (new URL('/UpdateCall', config.BASE_URL)).href,
    "state": "active",
    "redirectMethod": "POST"
    });
    try {
        await voiceController.modifyCall(config.BANDWIDTH_ACCOUNT_ID, tag, body);
    } catch (error) {
        console.error(error);
    }
  }
}


/**
 * Update the A-leg to record a voicemail
 *
 * @return {string} The generated BXML
 */
exports.updateCall = (req, res) => {
  const event = req.body;
  var speakSentence = new BandwidthBxml.Verbs.SpeakSentence();
  speakSentence.setSentence("The person you are trying to reach is not available, please leave a message at the tone");
  speakSentence.setVoice("julie");

  var playAudio = new BandwidthBxml.Verbs.PlayAudio();
  playAudio.setUrl("https://www.soundjay.com/button/sounds/beep-01a.wav");

  var record = new BandwidthBxml.Verbs.Record();
  record.setRecordingAvailableUrl(new URL('/Recording', config.BASE_URL).href);    // (new URL('/Recording', config.BASE_URL)).href);
  record.setRecordingAvailableMethod("POST")
  record.setMaxDuration(30);

  var response = new BandwidthBxml.Response();
  response.addVerb(speakSentence);
  response.addVerb(playAudio);
  response.addVerb(record);
  const bxml = response.toBxml();
  res.send(bxml);
}


/**
 * Download the generated recording if the call isn't answered
 */
exports.downloadRecording = async (req, res) => {
  var fs = require('fs');
  const recording = req.body;
  const recordingId = recording.recordingId;
  const callId = recording.callId;

  var response = await voiceController.getStreamRecordingMedia(config.BANDWIDTH_ACCOUNT_ID, callId, recordingId);
  fs.writeFileSync('./Recordings/'.concat(recording.recordingId.concat('.wav')), response, 'binary');
}


/**
 * Capture call status
 */
exports.status = (req, res) => {
  const status = req.body;
  // console.log('Call Status:', status)
}
