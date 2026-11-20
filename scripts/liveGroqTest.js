require('dotenv').config();
const { parseTaskRequest } = require('../services/ai/taskAgentService');

async function runLiveTests() {
    console.log('=== RUNNING REAL GROQ AI TESTS ===');
    console.log('Model:', process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
    console.log('Has API Key:', Boolean(process.env.GROQ_API_KEY));

    const mockUser = {
        _id: '670000000000000000000001',
        name: 'Test Employee',
        role: 'employee',
        companyRole: 'employee',
        company: '670000000000000000000002',
        companyCode: 'CIIS',
    };

    const callAgent = (opts) =>
        parseTaskRequest({
            req: { user: mockUser },
            language: 'hinglish',
            ...opts,
        });

    // Test 1: The exact failing sentence
    console.log('\n----------------------------------------');
    console.log('TEST 1: The exact failing sentence (STT typos: "cal", "vah", "jaega")');
    const input1 = "Mera task create karo uska naam yah voice change ho aur uska description pipeline connection and vah cal Subah 10:00 complete ho jaega";
    console.log('User input:', input1);
    const res1 = await callAgent({ message: input1 });
    console.log('\n--- RAW JSON RESPONSE 1 ---');
    console.log(JSON.stringify(res1, null, 2));

    // Test 2: Devanagari sentence with technical terms
    console.log('\n----------------------------------------');
    console.log('TEST 2: Devanagari sentence ("डेटाबेस बैकअप", "सर्वर माइग्रेशन")');
    const input2 = "टास्क बनाओ जिसका नाम डेटाबेस बैकअप हो और डिस्क्रिप्शन सर्वर माइग्रेशन और यह कल शाम 6 बजे तक पूरा हो जाना चाहिए";
    console.log('User input:', input2);
    const res2 = await callAgent({ message: input2 });
    console.log('\n--- RAW JSON RESPONSE 2 ---');
    console.log(JSON.stringify(res2, null, 2));

    // Test 3: Guided flow with skips
    console.log('\n----------------------------------------');
    console.log('TEST 3: Guided flow with skips');

    // Turn 3.1: "Naya task create karo"
    console.log('\nTurn 3.1: "Naya task create karo"');
    const res3_1 = await callAgent({ message: "Naya task create karo" });
    console.log('Assistant asked:', res3_1.field, res3_1.reply);

    // Turn 3.2: "Client meeting" (title)
    console.log('\nTurn 3.2: "Client meeting"');
    const res3_2 = await callAgent({ message: "Client meeting", draft: res3_1.draft });
    console.log('Assistant asked:', res3_2.field, res3_2.reply);

    // Turn 3.3: "koi nahi" (skip description)
    console.log('\nTurn 3.3: "koi nahi" (skip description)');
    const res3_3 = await callAgent({ message: "koi nahi", draft: res3_2.draft });
    console.log('Assistant asked:', res3_3.field, res3_3.reply);

    // Turn 3.4: "kal subah 11 baje" (due date)
    console.log('\nTurn 3.4: "kal subah 11 baje"');
    const res3_4 = await callAgent({ message: "kal subah 11 baje", draft: res3_3.draft });
    console.log('Assistant asked:', res3_4.field, res3_4.reply);

    // Turn 3.5: "baaki sab default" (skip remaining optional fields)
    console.log('\nTurn 3.5: "baaki sab default"');
    const res3_5 = await callAgent({ message: "baaki sab default", draft: res3_4.draft });
    console.log('\n--- RAW JSON RESPONSE 3 (Final Ready State) ---');
    console.log(JSON.stringify(res3_5, null, 2));

    console.log('\n=== REAL GROQ TESTS FINISHED SUCCESSFULLY ===');
}

runLiveTests().catch((err) => {
    console.error('Real Groq test error:', err);
    process.exit(1);
});
