# app.rb
#
# Sinatra app to run the recording sample app
#
# @copyright Bandwidth INC

require 'sinatra'
require 'bandwidth'
require 'json'

include Bandwidth
include Bandwidth::Voice
include Bandwidth::Messaging

begin
    MESSAGING_ACCOUNT_ID = ENV.fetch("MESSAGING_ACCOUNT_ID")
    MESSAGING_API_TOKEN = ENV.fetch("MESSAGING_API_TOKEN")
    MESSAGING_API_SECRET = ENV.fetch("MESSAGING_API_SECRET")
    MESSAGING_APPLICATION_ID = ENV.fetch("MESSAGING_APPLICATION_ID")
    VOICE_ACCOUNT_ID = ENV.fetch("VOICE_ACCOUNT_ID")
    VOICE_API_USERNAME = ENV.fetch("VOICE_API_USERNAME")
    VOICE_API_PASSWORD = ENV.fetch("VOICE_API_PASSWORD")
    VOICE_APPLICATION_ID = ENV.fetch("VOICE_APPLICATION_ID")
    BASE_URL = ENV.fetch("BASE_URL")
rescue
    puts "Please set the environmental variables defined in the README"
    exit(-1)
end

bandwidth_client = Bandwidth::Client.new(
    voice_basic_auth_user_name: VOICE_API_USERNAME,
    voice_basic_auth_password: VOICE_API_PASSWORD,
    messaging_basic_auth_user_name: MESSAGING_API_TOKEN,
    messaging_basic_auth_password: MESSAGING_API_SECRET,
)

$voice_client = bandwidth_client.voice_client.client
$messaging_client = bandwidth_client.messaging_client.client

post "/VoiecCallback" do
    ring_audio = Bandwidth::Voice::PlayAudio.new({
        :url => "https://www.kozco.com/tech/piano2.wav"
    })
    leave_voicemail = Bandwidth::Voice::SpeakSentence.new({
        :sentence => "Please leave a message after the beep. Your time limit is 3 minutes. Press # to stop the recording early"
    })
    redirect = Bandwidth::Voice::Redirect.new({
        :redirect_url => "/RecordCallback"
    }) 
    response = Bandwidth::Voice::Response.new()
    response.push(ring_audio)
    response.push(leave_voicemail)
    response.push(redirect)
    return response.to_bxml()
end

post "/RecordCallback" do
    beep_audio = Bandwidth::Voice::PlayAudio.new({
        :url => "https://www.kozco.com/tech/piano2.wav"
    })
    start_recording = Bandwidth::Voice::Record.new({
        :record_complete_url => "/RecordCompleteCallback",
        :record_complete_method => "POST",
        :recording_available_url => "/RecordingAvailableCallback",
        :recording_available_method => "POST",
        :max_duration => 180,
        :terminating_digits => "#"
    })
    response = Bandwidth::Voice::Response.new()
    response.push(beep_audio)
    response.push(start_recording)
    return response.to_bxml()
end

post "/RecordCompleteCallback" do
    #Loops endlessly until the recording is available
    pause = Bandwidth::Voice::Pause.new({
        :duration => 3
    })
    redirect = Bandwidth::Voice::Redirect.new({
        :redirect_url => "/RecordCompleteCallback"
    })
    response = Bandwidth::Voice::Response.new()
    response.push(pause)
    response.push(redirect)
    return response.to_bxml()
end

post "/RecordingAvailableCallback" do
    data = JSON.parse(request.body.read)
    if data["status"] == "complete" 
        #Update call to get bxml at "/AskToHearRecordingGather" with the recording id as the tag
        body = ApiModifyCallRequest.new
        body.redirect_url = BASE_URL + "/AskToHearRecordingGather" #TODO: Can this be a relative url?
        body.tag = data["recordingId"]
        
        begin
            $voice_client.modify_call(VOICE_ACCOUNT_ID, data["callId"], body: body)
        rescue Exception => e
            puts e
        end
    end
end

post "/AskToHearRecordingGather" do
    #ID of recording is in the tag
    #TBD: Do we need the call id too?
    data = JSON.parse(request.body.read)
    ask_to_hear_recording = Bandwidth::Voice::SpeakSentence.new({
        :sentence => "Your recording is now available. If you'd like to hear your recording, press 1, otherwise please hangup"
    })
    gather = Bandwidth::Voice::Gather.new({
        :timeout => 15,
        :speak_sentence => ask_to_hear_recording,
        :max_digits => 1,
        :gather_url => "/AskToHearRecordingEndGather",
        :tag => data["tag"]
    })
    response = Bandwidth::Voice::Response.new()
    response.push(gather)
    return response.to_bxml()
end

post "/AskToHearRecordingEndGather" do
    #ID of recording is in the tag
    #TBD: Do we need the call id too?
    data = JSON.parse(request.body.read)
    response = Bandwidth::Voice::Response.new()
    if data.key?("digits") and data["digits"] == "1"
        #play recording
        play_recording = Bandwidth::Voice::PlayAudio.new({
            :url => "url of recording"
        })
        ask_to_re_record = Bandwidth::Voice::SpeakSentence.new({
            :sentence => "Would you like to re record? Press 1 if so, otherwise please hangup"
        })
        
        gather = Bandwidth::Voice::Gather.new({
            :timeout => 15,
            :speak_sentence => ask_to_re_record,
            :max_digits => 1,
            :gather_url => "/AskToReRecordEndGather",
        })
        response.push(play_recording)
        response.push(gather)
    else
        hangup = Bandwidth::Voice::Hangup.new()
        response.push(hangup)
    end
    return response.to_bxml()
end

post "/AskToReRecordEndGather" do
    data = JSON.parse(request.body.read)
    response = Bandwidth::Voice::Response.new()
    if data.key?("digits") and data["digits"] == "1"
        redirect = Bandwidth::Voice::Redirect.new({
            :redirect_url => "/RecordCallback"
        })
        response.push(redirect)
    else
        hangup = Bandwidth::Voice::Hangup.new()
        response.push(hangup)
    end
    return response.to_bxml()
end

