// Scripture detection + lookup, replacing AppDeploy's ai.generate() calls.
//
// Two-stage design (per the product's own plan):
// 1. Gemini's job: given spoken transcript, decide if/what scripture is being referenced
//    or quoted. This is a judgment call — a good fit for an LLM.
// 2. API Bible's job: given a detected reference, fetch the *actual, verified* verse
//    text from a real Bible database. Verse wording should never come from an LLM's
//    memory — only from a real source — so a broadcast never shows a misquoted verse.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const API_BIBLE_KEY = process.env.API_BIBLE_KEY;
// Default API Bible bibleId for KJV. Override per-translation with API_BIBLE_IDS below if needed.
const DEFAULT_BIBLE_ID = process.env.API_BIBLE_DEFAULT_ID || 'de4e12af7f28f599-02'; // KJV on API.Bible

const TRANSLATION_BIBLE_IDS: Record<string, string> = {
    KJV: process.env.API_BIBLE_ID_KJV || 'de4e12af7f28f599-02',
    ASV: process.env.API_BIBLE_ID_ASV || '06125adad2d5898a-01',
    WEB: process.env.API_BIBLE_ID_WEB || '9879dbb7cfe39e4d-04',
};

export interface BibleAnalysis {
    type: 'reference' | 'quotation' | 'none' | 'verify';
    reference: string;
    translation: string;
    verse_text: string;
    confidence: 'high' | 'medium' | 'verify';
    explanation: string;
}

export interface BiblePassage {
    reference: string;
    translation: string;
    verse_text: string;
    confidence: string;
}

async function callGemini(system: string, prompt: string, schemaHint: string): Promise<any> {
    if (!GEMINI_API_KEY) {
        throw new Error('gemini_not_configured');
    }
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: `${system}\n\nRespond ONLY with JSON matching this shape, no prose, no markdown fences: ${schemaHint}` }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0, maxOutputTokens: 500 },
            }),
        }
    );
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`gemini_request_failed:${res.status}:${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('gemini_empty_response');
    const cleaned = text.replace(/```json\s*|```\s*$/g, '').trim();
    return JSON.parse(cleaned);
}

// Stage 2: look up the verified verse text from API Bible for a reference Gemini identified.
export async function lookupVerse(reference: string, translation: string): Promise<{ verse_text: string; found: boolean }> {
    if (!API_BIBLE_KEY) {
        return { verse_text: '', found: false };
    }
    const bibleId = TRANSLATION_BIBLE_IDS[translation.toUpperCase()] || DEFAULT_BIBLE_ID;
    try {
        const searchRes = await fetch(
            `https://api.scripture.api.bible/v1/bibles/${bibleId}/search?query=${encodeURIComponent(reference)}&limit=1`,
            { headers: { 'api-key': API_BIBLE_KEY } }
        );
        if (!searchRes.ok) return { verse_text: '', found: false };
        const searchData = await searchRes.json();
        const passageId = searchData?.data?.passages?.[0]?.id || searchData?.data?.verses?.[0]?.id;
        if (!passageId) return { verse_text: '', found: false };
        const passageRes = await fetch(
            `https://api.scripture.api.bible/v1/bibles/${bibleId}/passages/${passageId}?content-type=text&include-titles=false&include-verse-numbers=false`,
            { headers: { 'api-key': API_BIBLE_KEY } }
        );
        if (!passageRes.ok) return { verse_text: '', found: false };
        const passageData = await passageRes.json();
        const content = (passageData?.data?.content || '').trim().replace(/\s+/g, ' ');
        return content ? { verse_text: content, found: true } : { verse_text: '', found: false };
    } catch (err) {
        console.error('api_bible_lookup_failed', reference, err);
        return { verse_text: '', found: false };
    }
}

// Stage 1: analyze a live transcript chunk for a scripture reference or quotation.
export async function analyzeBible(transcript: string, translation: string): Promise<BibleAnalysis> {
    const result = await callGemini(
        'You are TAC Stream Bible Intelligence. For every spoken statement, first decide whether it is an explicit Bible reference, a natural-language Bible quotation, or ordinary speech. Do not label ordinary religious language as Scripture merely because similar words occur in the Bible. Explicit references include book/chapter/verse forms and natural forms such as "Psalm 57 verse 1" or "John chapter 3 verse 16". Quoted Scripture must be a recognizable passage or phrase and should only receive a reference when the evidence is strong; otherwise return verify. Never invent verse wording yourself — leave verse_text empty, it will be looked up separately from a verified source.',
        `Analyze this spoken transcript: "${transcript}". Determine whether it is a Bible reference, a quoted Bible passage, or not Scripture. If it is a reference or quotation, normalize the likely reference (e.g. "John 3:16") and explain briefly. Translation context: ${translation}.`,
        '{"type":"reference|quotation|none|verify","reference":"string","translation":"string","verse_text":"","confidence":"high|medium|verify","explanation":"string"}'
    );
    const analysis: BibleAnalysis = {
        type: result.type === 'reference' || result.type === 'quotation' || result.type === 'verify' ? result.type : 'none',
        reference: String(result.reference || ''),
        translation: String(result.translation || translation),
        verse_text: '',
        confidence: result.confidence === 'high' || result.confidence === 'medium' ? result.confidence : 'verify',
        explanation: String(result.explanation || ''),
    };
    // If Gemini found a likely reference, fetch the real, verified text from API Bible.
    if ((analysis.type === 'reference' || analysis.type === 'quotation') && analysis.reference) {
        const { verse_text, found } = await lookupVerse(analysis.reference, analysis.translation);
        if (found) {
            analysis.verse_text = verse_text;
        } else {
            // Couldn't verify the actual wording — don't show unverified text on a broadcast.
            analysis.type = 'verify';
            analysis.confidence = 'verify';
        }
    }
    return analysis;
}

// Direct lookup by reference (used by "POST /api/bible/generate").
export async function generatePassage(reference: string, translation: string): Promise<BiblePassage> {
    const { verse_text, found } = await lookupVerse(reference, translation);
    if (!found) {
        return { reference, translation, verse_text: '', confidence: 'verify' };
    }
    return { reference, translation, verse_text, confidence: 'high' };
}
