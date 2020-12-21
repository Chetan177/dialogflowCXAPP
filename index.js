const { SessionsClient } = require('@google-cloud/dialogflow-cx');
const fs = require('fs');
const util = require('util');
const request = require('http')
const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2));
var FileWriter = require('wav').FileWriter;

let calluuid ="" ;
let agentId = ""

const port = argv.port && parseInt(argv.port) ? parseInt(argv.port) : 3001
const audioPath = "/tmp/"

const credLocation = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let rawdata = fs.readFileSync(credLocation);
let googleCred = JSON.parse(rawdata);

console.log(`GoogleCred location; ${credLocation}`);

const projectId = googleCred.project_id;
const encoding = 'AUDIO_ENCODING_LINEAR_16';
const sampleRateHertz = 16000;
const languageCode = 'en';

let writeFlag = true;

function writeAudioToFile(audioBuffer) {
    let filePath = audioPath + uuid.v4() + '.wav'
    let outputFileStream = new FileWriter(filePath, {
        sampleRate: 24000,
        channels: 1
    });
    outputFileStream.write(audioBuffer);
    return filePath;
}


function getDialogflowCXStream() {
    const client = new SessionsClient();
    /**
     * Example for regional endpoint:
     *   const location = 'us-central1'
     *   const client = new SessionsClient({apiEndpoint: 'us-central1-dialogflow.googleapis.com'})
     */
    const sessionId = Math.random().toString(36).substring(7);
    const sessionPath = client.projectLocationAgentSessionPath(
        projectId,
        location,
        agentId,
        sessionId
    );
    console.info(sessionPath);

    // Create a stream for the streaming request.
    const detectStream = client
        .streamingDetectIntent()
        .on('error', console.error)
        .on('data', data => {
            if (data.recognitionResult) {
                console.log(
                    `Intermediate Transcript: ${data.recognitionResult.transcript}`
                );
            } else {
                console.log('Detected Intent:');
                const result = data.detectIntentResponse.queryResult;

                console.log(`User Query: ${result.transcript}`);
                for (const message of result.responseMessages) {
                    if (message.text) {
                        console.log(`Agent Response: ${message.text.text}`);
                    }
                }
                if (result.match.intent) {
                    console.log(`Matched Intent: ${result.match.intent.displayName}`);
                }
                console.log(`Current Page: ${result.currentPage.displayName}`);
            }
        });

    // Write the initial stream request to config for audio input.
    const initialStreamRequest = {
        session: sessionPath,
        queryInput: {
            audio: {
                config: {
                    audioEncoding: encoding,
                    sampleRateHertz: sampleRateHertz,
                    singleUtterance: true,
                },
            },
            languageCode: languageCode,
        },
    };
    detectStream.write(initialStreamRequest);

    return detectStream;
}

console.log(`listening on port ${port}`);

const wss = new WebSocket.Server({
    port,
    handleProtocols: (protocols, req) => {
        return 'audio.drachtio.org';
    }
});

wss.on('connection', (ws, req) => {
    console.log(`received connection from ${req.connection.remoteAddress}`);
    let dialogflowCXStreamer = getDialogflowCXStream();

    ws.on('message', (message) => {
        if (typeof message === 'string') {
            console.log(`received message: ${message}`);
        } else if (message instanceof Buffer) {
            // Stream the audio from audio to Dialogflow.
            if (writeFlag) {
                dialogflowCXStreamer.write({ queryInput: { audio: { audio: message } } });
            } else {
                dialogflowCXStreamer = getDialogflowCXStream();
                dialogflowCXStreamer.write({ queryInput: { audio: { audio: message } } });
                writeFlag = true;
            }

        }
    });

    ws.on('close', (code, reason) => {
        console.log(`socket closed ${code}:${reason}`);
        dialogflowCXStreamer.end();
    });
});

// ToDo Further handling of Modify and flow

