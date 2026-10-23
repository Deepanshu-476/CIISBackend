require('dotenv').config();
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { DEFAULT_MODEL, VOCABULARY_PROMPT } = require('../services/ai/transcribeService');

async function main() {
    console.log('====================================================');
    console.log('PART 5: REAL GROQ RUN FOR EXACT OBSERVED SENTENCES');
    console.log('====================================================');

    const sttModel = process.env.GROQ_STT_MODEL || DEFAULT_MODEL;
    const sttLang = process.env.GROQ_STT_LANGUAGE || 'client mic setting (hi)';
    console.log('\n[Whisper Configuration]');
    console.log('Model:', sttModel, '(Note: whisper-large-v3-turbo default; whisper-large-v3 is more accurate for complex Hindi/Hinglish)');
    console.log('Language setting:', sttLang);
    console.log('Prompt hint (Roman Hinglish):', VOCABULARY_PROMPT);

    const mockEmployee = {
        _id: '670000000000000000000099',
        name: 'Kanika',
        role: 'employee',
        companyRole: 'employee',
        department: 'IT',
        company: '670000000000000000000002',
        companyCode: 'CIIS',
    };

    const sentence1 = "मेरे task create करो, उसका नाम रखो, A Voice Agents, उसका description रखो, adding speech to text in pipeline, उसकी priority रखो high, studio रखो, आज शाम साथ वजे, और reminder कोई भी नी चाहिए, और बाखी by default अब तो सारा रोचे,";

    console.log('\n--- INPUT SENTENCE 1 ---');
    console.log(sentence1);

    const res1 = await parseTaskRequest({
        req: { user: mockEmployee },
        message: sentence1,
        language: 'hi',
    });

    console.log('\n--- GROQ RESULT 1: DRAFT JSON + INTENT ---');
    console.log('Status:', res1.status);
    console.log('Intent:', JSON.stringify(res1.intent));
    console.log('Field:', res1.field);
    console.log('Draft JSON:');
    console.log(JSON.stringify(res1.draft, null, 2));
    console.log('Spoken Speech (hi-IN):', res1.speech);
    console.log('Reply:', res1.reply);

    console.log('\n====================================================');
    console.log('SIMULATING FULL HANDS-FREE FLOW USING TYPED TRANSCRIPTS');
    console.log('====================================================');

    // Turn 1: User speaks sentence 1.
    // The response has status 'ready' or asks remaining required/attachments.
    console.log('\nTurn 1 (Initial spoken request):');
    console.log('User transcript:', sentence1);
    console.log('Agent status:', res1.status, '| intent:', res1.intent?.type);
    console.log('Agent speech:', res1.speech);

    let currentDraft = res1.draft;

    // Turn 2: User says "Haan, create kar do" or handles attachment/confirm
    let res2;
    if (res1.status === 'ready') {
        console.log('\nTurn 2 (Confirmation step):');
        const input2 = "Haan create kar do";
        console.log('User transcript:', input2);
        res2 = await parseTaskRequest({
            req: { user: mockEmployee },
            message: input2,
            draft: currentDraft,
            language: 'hi',
        });
        console.log('Agent status:', res2.status, '| intent:', res2.intent?.type);
        console.log('Agent speech:', res2.speech);
        console.log('Payload ready for form creation:', Boolean(res2.payload));
        if (res2.payload) {
            console.log('Payload fields:', JSON.stringify(res2.payload.fields, null, 2));
        }
    } else {
        // If an optional field like attachments or something was asked:
        console.log('\nTurn 2 (Response to pending question:', res1.field, '):');
        const input2 = "नहीं reminder उन्हें करना और बाकि सब default है";
        console.log('User transcript:', input2);
        res2 = await parseTaskRequest({
            req: { user: mockEmployee },
            message: input2,
            draft: currentDraft,
            language: 'hi',
        });
        console.log('Agent status:', res2.status, '| intent:', res2.intent?.type);
        console.log('Agent speech:', res2.speech);
        console.log('Draft reminder:', res2.draft?.fields?.reminder);
        console.log('Payload ready for form creation:', Boolean(res2.payload));
    }

    console.log('\n--- VERIFICATION OF SECOND SENTENCE ISOLATED ---');
    console.log('Testing: "नहीं reminder उन्हें करना और बाकि सब default है" with pending priorityDays');
    const resSentence2 = await parseTaskRequest({
        req: { user: mockEmployee },
        message: "नहीं reminder उन्हें करना और बाकि सब default है",
        draft: {
            title: 'A Voice Agents',
            description: 'adding speech to text in pipeline',
            priority: 'high',
            dueDateTime: '2026-10-19T19:00:00+05:30',
            reminder: null,
            priorityDays: null,
            asked: ['title', 'description', 'dueDateTime', 'priority', 'priorityDays'],
            skipped: [],
        },
        language: 'hi',
    });
    console.log('Isolated sentence 2 status:', resSentence2.status);
    console.log('Isolated sentence 2 intent:', JSON.stringify(resSentence2.intent));
    console.log('Isolated sentence 2 reminder field:', resSentence2.draft?.reminder);
    console.log('Isolated sentence 2 skipped list:', resSentence2.draft?.skipped);

    console.log('\n====================================================');
    console.log('REAL GROQ RUN & HANDS-FREE SIMULATION FINISHED');
    console.log('====================================================');
}

main().catch((err) => {
    console.error('Execution error:', err);
    process.exit(1);
});
