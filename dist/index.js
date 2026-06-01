#!/usr/bin/env node
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
// .env ファイルの読み込み
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_RATES = {
    'claude-3-5-sonnet': { input: 3.0 / 1000000, output: 15.0 / 1000000, name: 'Claude 3.5 Sonnet' },
    'claude-3-5-sonnet-20241022': { input: 3.0 / 1000000, output: 15.0 / 1000000, name: 'Claude 3.5 Sonnet' },
    'claude-3-5-haiku': { input: 0.8 / 1000000, output: 4.0 / 1000000, name: 'Claude 3.5 Haiku' },
    'claude-3-5-haiku-20241022': { input: 0.8 / 1000000, output: 4.0 / 1000000, name: 'Claude 3.5 Haiku' },
    'claude-3-opus': { input: 15.0 / 1000000, output: 75.0 / 1000000, name: 'Claude 3 Opus' },
    'claude-3-opus-20240229': { input: 15.0 / 1000000, output: 75.0 / 1000000, name: 'Claude 3 Opus' },
    'claude-3-haiku': { input: 0.25 / 1000000, output: 1.25 / 1000000, name: 'Claude 3 Haiku' },
    'claude-3-haiku-20240307': { input: 0.25 / 1000000, output: 1.25 / 1000000, name: 'Claude 3 Haiku' },
    // OpenAI / Codex（includes一致のため -mini を先に置く）
    'gpt-4o-mini': { input: 0.15 / 1000000, output: 0.6 / 1000000, name: 'GPT-4o mini' },
    'gpt-4.1-mini': { input: 0.4 / 1000000, output: 1.6 / 1000000, name: 'GPT-4.1 mini' },
    'o4-mini': { input: 1.1 / 1000000, output: 4.4 / 1000000, name: 'o4-mini' },
    'gpt-4o': { input: 2.5 / 1000000, output: 10.0 / 1000000, name: 'GPT-4o' },
    'gpt-4.1': { input: 2.0 / 1000000, output: 8.0 / 1000000, name: 'GPT-4.1' },
    'gpt-5': { input: 1.25 / 1000000, output: 10.0 / 1000000, name: 'GPT-5' },
    'o3': { input: 2.0 / 1000000, output: 8.0 / 1000000, name: 'o3' }
};
const DEFAULT_RATE = { input: 3.0 / 1000000, output: 15.0 / 1000000, name: 'Claude 3.5 Sonnet (Default)' };
const stats = {
    todayCostUsd: 0.0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    japaneseWastedCostUsd: 0.0,
    japaneseWastedTokens: 0,
    totalRequests: 0,
    blockedRequests: 0,
    dailyBudgetLimitUsd: 5.0, // デフォルト予算 $5.00
    licenseKey: '',
    licenseStatus: 'free',
    requestsLog: []
};
// ----------------------------------------------------
// Helper Functions
// ----------------------------------------------------
function getModelRate(modelName) {
    const normalized = modelName.toLowerCase();
    for (const [key, rate] of Object.entries(MODEL_RATES)) {
        if (normalized.includes(key)) {
            return rate;
        }
    }
    return DEFAULT_RATE;
}
// 日本語文字数をカウントして、英語プロンプト比でどれだけトークンを無駄にしたか推定する
// 日本語は1文字約1.3トークン消費、英語なら約1/3のトークンで同内容を伝達可能と仮定。
// 浪費トークン = 日本語トークン数の 2/3 (約66%)
function estimateJapaneseWastedTokens(text) {
    const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
    const match = text.match(japaneseRegex);
    const japaneseCharsCount = match ? match.length : 0;
    const estJapaneseTokens = Math.floor(japaneseCharsCount * 1.3);
    const wastedTokens = Math.floor(estJapaneseTokens * (2 / 3));
    return wastedTokens;
}
// リクエストボディからプロンプトの全テキストを抽出
function extractTextFromBody(body) {
    let text = '';
    if (typeof body.system === 'string') {
        text += body.system;
    }
    else if (Array.isArray(body.system)) {
        for (const sys of body.system) {
            if (sys.type === 'text')
                text += sys.text;
        }
    }
    if (Array.isArray(body.messages)) {
        for (const msg of body.messages) {
            if (typeof msg.content === 'string') {
                text += msg.content;
            }
            else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        text += part.text;
                    }
                }
            }
        }
    }
    return text;
}
// ダッシュボードHTMLの読み込み（見つからない場合はフォールバック）
function getDashboardHtml() {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(htmlPath)) {
        return fs.readFileSync(htmlPath, 'utf8');
    }
    const srcHtmlPath = path.join(__dirname, '../src/dashboard.html');
    if (fs.existsSync(srcHtmlPath)) {
        return fs.readFileSync(srcHtmlPath, 'utf8');
    }
    // 最小限のインラインフォールバックHTML
    return `<!DOCTYPE html><html><head><title>yakushield (フォールバック)</title></head><body><h1>yakushield Dashboard</h1><p>dashboard.html が見つかりません。再ビルドしてください。</p></body></html>`;
}
// ----------------------------------------------------
// Mock LLM Response Generators
// ----------------------------------------------------
const MOCK_ANSWERS = [
    "こんにちは！私は yakushield のモックAIです。本物の Anthropic API キーが設定されていないため、モック応答を返しています。ダッシュボードで予算スライダーを操作して、物理予算ブレーカーのテストを行ってみてください！",
    "はい、了解しました。現在のプロキシは正常に機能しています。日本語は英語と比較してトークンを多く消費するため、英語で書くことで約3分の1のコストに抑えることができます。これが『日本語トークン浪費の見える化』です。",
    "yakushield（訳シールド）は、Claude Code などの LLM クライアントからの予期せぬループ暴走と高額請求を確実に防ぐために開発された、軽量なローカル LLM プロキシサーバーです。"
];
function generateMockContent() {
    const idx = Math.floor(Math.random() * MOCK_ANSWERS.length);
    return MOCK_ANSWERS[idx];
}
// ----------------------------------------------------
// HTTP Server Definition
// ----------------------------------------------------
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4040;
const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Anthropic-Version');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    const urlPath = req.url || '';
    // 1. 静的ダッシュボードの配信
    if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
        return;
    }
    // 2. 統計API取得
    if (urlPath === '/api/stats' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ...stats,
            hasRealKey: !!process.env.ANTHROPIC_API_KEY
        }));
        return;
    }
    // 3. 設定更新API
    if (urlPath === '/api/settings' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (typeof data.dailyBudgetLimitUsd === 'number') {
                    stats.dailyBudgetLimitUsd = parseFloat(data.dailyBudgetLimitUsd.toFixed(4));
                }
                if (typeof data.licenseKey === 'string') {
                    stats.licenseKey = data.licenseKey;
                    // スタブライセンス認証: YS- で始まる16文字のキーであればPro扱いにする形式チェック
                    if (/^YS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.licenseKey)) {
                        stats.licenseStatus = 'pro';
                    }
                    else if (data.licenseKey === '') {
                        stats.licenseStatus = 'free';
                    }
                    else {
                        stats.licenseStatus = 'invalid';
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, stats }));
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON', message: err.message }));
            }
        });
        return;
    }
    // 4. モックシミュレータ用トリガーAPI
    if (urlPath === '/api/mock-trigger' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const japaneseText = data.text || 'これはテスト送信用のダミーメッセージです。';
                const model = data.model || 'claude-3-5-sonnet-20241022';
                // 予算超過チェック
                if (stats.todayCostUsd >= stats.dailyBudgetLimitUsd) {
                    stats.blockedRequests++;
                    stats.totalRequests++;
                    stats.requestsLog.unshift({
                        timestamp: new Date().toLocaleTimeString('ja-JP'),
                        model: getModelRate(model).name,
                        inputTokens: 0,
                        outputTokens: 0,
                        costUsd: 0,
                        wastedCostUsd: 0,
                        status: 'blocked',
                        isMock: true
                    });
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        type: 'error',
                        error: {
                            type: 'over_budget_error',
                            message: `yakushield: 予算上限 $${stats.dailyBudgetLimitUsd.toFixed(2)} に達したため遮断されました。`
                        }
                    }));
                    return;
                }
                // ダミートークン算出
                const textLen = japaneseText.length;
                const estInputTokens = Math.floor(textLen * 1.4) + 100; // プロンプト + システム
                const estOutputTokens = 80 + Math.floor(Math.random() * 50);
                const rate = getModelRate(model);
                const cost = (estInputTokens * rate.input) + (estOutputTokens * rate.output);
                // 日本語浪費計算
                const wastedTokens = estimateJapaneseWastedTokens(japaneseText);
                const finalWastedTokens = Math.min(wastedTokens, estInputTokens);
                const wastedCost = finalWastedTokens * rate.input;
                // 統計加算
                stats.todayCostUsd = parseFloat((stats.todayCostUsd + cost).toFixed(6));
                stats.todayInputTokens += estInputTokens;
                stats.todayOutputTokens += estOutputTokens;
                stats.japaneseWastedTokens += finalWastedTokens;
                stats.japaneseWastedCostUsd = parseFloat((stats.japaneseWastedCostUsd + wastedCost).toFixed(6));
                stats.totalRequests++;
                stats.requestsLog.unshift({
                    timestamp: new Date().toLocaleTimeString('ja-JP'),
                    model: rate.name,
                    inputTokens: estInputTokens,
                    outputTokens: estOutputTokens,
                    costUsd: parseFloat(cost.toFixed(6)),
                    wastedCostUsd: parseFloat(wastedCost.toFixed(6)),
                    status: 'success',
                    isMock: true
                });
                // 履歴上限
                if (stats.requestsLog.length > 50)
                    stats.requestsLog.pop();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    addedCostUsd: cost,
                    usage: {
                        input_tokens: estInputTokens,
                        output_tokens: estOutputTokens
                    },
                    stats
                }));
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON', message: err.message }));
            }
        });
        return;
    }
    // 5. Anthropic API メッセージパススルー (中継プロキシ本体)
    if ((urlPath === '/v1/messages' || urlPath === '/messages') && req.method === 'POST') {
        let bodyData = '';
        req.on('data', chunk => { bodyData += chunk; });
        req.on('end', async () => {
            try {
                const body = JSON.parse(bodyData);
                const model = body.model || 'claude-3-5-sonnet-20241022';
                const isStream = body.stream === true;
                const rate = getModelRate(model);
                // 日本語テキストの解析と浪費予測（事前）
                const fullPromptText = extractTextFromBody(body);
                const wastedInputTokens = estimateJapaneseWastedTokens(fullPromptText);
                // --- A. 物理予算ブレーカーの判定 ---
                if (stats.todayCostUsd >= stats.dailyBudgetLimitUsd) {
                    stats.blockedRequests++;
                    stats.totalRequests++;
                    stats.requestsLog.unshift({
                        timestamp: new Date().toLocaleTimeString('ja-JP'),
                        model: rate.name,
                        inputTokens: 0,
                        outputTokens: 0,
                        costUsd: 0,
                        wastedCostUsd: 0,
                        status: 'blocked',
                        isMock: false
                    });
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        type: 'error',
                        error: {
                            type: 'over_budget_error',
                            message: `yakushield [物理予算ブレーカー作動]: 1日の上限予算 ($${stats.dailyBudgetLimitUsd.toFixed(2)}) を超過したため、リクエストを遮断しました。ダッシュボード (http://localhost:4040) で上限を引き上げることができます。`
                        }
                    }));
                    return;
                }
                // --- B. APIキーの特定 ---
                const reqApiKey = req.headers['x-api-key'];
                const localApiKey = process.env.ANTHROPIC_API_KEY;
                const finalApiKey = reqApiKey || localApiKey;
                // --- C. キーが無い場合は自動でモックモード ---
                if (!finalApiKey) {
                    stats.totalRequests++;
                    const mockText = generateMockContent();
                    const estInputTokens = Math.floor(fullPromptText.length * 1.2) + 80;
                    const estOutputTokens = Math.floor(mockText.length * 1.5);
                    const cost = (estInputTokens * rate.input) + (estOutputTokens * rate.output);
                    const wastedCost = Math.min(wastedInputTokens, estInputTokens) * rate.input;
                    // 統計を更新
                    stats.todayCostUsd = parseFloat((stats.todayCostUsd + cost).toFixed(6));
                    stats.todayInputTokens += estInputTokens;
                    stats.todayOutputTokens += estOutputTokens;
                    stats.japaneseWastedTokens += Math.min(wastedInputTokens, estInputTokens);
                    stats.japaneseWastedCostUsd = parseFloat((stats.japaneseWastedCostUsd + wastedCost).toFixed(6));
                    stats.requestsLog.unshift({
                        timestamp: new Date().toLocaleTimeString('ja-JP'),
                        model: rate.name,
                        inputTokens: estInputTokens,
                        outputTokens: estOutputTokens,
                        costUsd: parseFloat(cost.toFixed(6)),
                        wastedCostUsd: parseFloat(wastedCost.toFixed(6)),
                        status: 'success',
                        isMock: true
                    });
                    if (stats.requestsLog.length > 50)
                        stats.requestsLog.pop();
                    if (isStream) {
                        // モックのストリーミング応答を段階的に返す
                        res.writeHead(200, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        });
                        // 1. message_start
                        res.write(`data: {"type": "message_start", "message": {"id": "mock_msg_stream", "type": "message", "role": "assistant", "model": "${model}", "content": [], "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": ${estInputTokens}, "output_tokens": 0}}}\n\n`);
                        // 2. content_block_start
                        res.write(`data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n`);
                        // 3. 文字を少しずつ流す
                        const chunks = [];
                        const words = mockText.split(/(\s+)/) || [mockText];
                        for (let i = 0; i < words.length; i += 2) {
                            const slice = (words[i] || '') + (words[i + 1] || '');
                            chunks.push(slice);
                        }
                        for (const chunk of chunks) {
                            await new Promise(resolve => setTimeout(resolve, 30));
                            res.write(`data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ${JSON.stringify(chunk)}}}\n\n`);
                        }
                        // 4. content_block_stop
                        res.write(`data: {"type": "content_block_stop", "index": 0}\n\n`);
                        // 5. message_delta
                        res.write(`data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": ${estOutputTokens}}}\n\n`);
                        // 6. message_stop
                        res.write(`data: {"type": "message_stop"}\n\n`);
                        res.end();
                    }
                    else {
                        // 非ストリーミング応答
                        await new Promise(resolve => setTimeout(resolve, 300));
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            id: 'mock_msg_nonstream',
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'text', text: mockText }],
                            model: model,
                            stop_reason: 'end_turn',
                            stop_sequence: null,
                            usage: {
                                input_tokens: estInputTokens,
                                output_tokens: estOutputTokens
                            }
                        }));
                    }
                    return;
                }
                // --- D. 本物の Anthropic API に中継 ---
                const options = {
                    hostname: 'api.anthropic.com',
                    path: '/v1/messages',
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-api-key': finalApiKey,
                        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
                    }
                };
                const clientReq = https.request(options, (clientRes) => {
                    // ヘッダー引き継ぎ
                    res.writeHead(clientRes.statusCode || 200, clientRes.headers);
                    let buffer = '';
                    clientRes.on('data', (chunk) => {
                        res.write(chunk);
                        buffer += chunk.toString();
                    });
                    clientRes.on('end', () => {
                        res.end();
                        stats.totalRequests++;
                        try {
                            let actualInput = 0;
                            let actualOutput = 0;
                            if (isStream) {
                                // ストリーミングレスポンスから usage を正規表現で抽出
                                // SSE の JSON チャンクの中から "usage": {"input_tokens": X, "output_tokens": Y} または "output_tokens": Y などを抽出
                                const inputMatch = buffer.match(/"input_tokens"\s*:\s*(\d+)/);
                                const outputMatches = [...buffer.matchAll(/"output_tokens"\s*:\s*(\d+)/g)];
                                if (inputMatch) {
                                    actualInput = parseInt(inputMatch[1], 10);
                                }
                                // output_tokens は message_delta や message_start で複数回出ることがあるので、最大値を取得するか足す
                                // Anthropicの場合、最終イベントの usage.output_tokens が累計を表す
                                if (outputMatches.length > 0) {
                                    const lastMatch = outputMatches[outputMatches.length - 1];
                                    actualOutput = parseInt(lastMatch[1], 10);
                                }
                            }
                            else {
                                // 通常の JSON レスポンス
                                const responseJson = JSON.parse(buffer);
                                if (responseJson.usage) {
                                    actualInput = responseJson.usage.input_tokens || 0;
                                    actualOutput = responseJson.usage.output_tokens || 0;
                                }
                            }
                            // 集計
                            if (actualInput > 0 || actualOutput > 0) {
                                const cost = (actualInput * rate.input) + (actualOutput * rate.output);
                                const finalWasted = Math.min(wastedInputTokens, actualInput);
                                const wastedCost = finalWasted * rate.input;
                                stats.todayCostUsd = parseFloat((stats.todayCostUsd + cost).toFixed(6));
                                stats.todayInputTokens += actualInput;
                                stats.todayOutputTokens += actualOutput;
                                stats.japaneseWastedTokens += finalWasted;
                                stats.japaneseWastedCostUsd = parseFloat((stats.japaneseWastedCostUsd + wastedCost).toFixed(6));
                                stats.requestsLog.unshift({
                                    timestamp: new Date().toLocaleTimeString('ja-JP'),
                                    model: rate.name,
                                    inputTokens: actualInput,
                                    outputTokens: actualOutput,
                                    costUsd: parseFloat(cost.toFixed(6)),
                                    wastedCostUsd: parseFloat(wastedCost.toFixed(6)),
                                    status: 'success',
                                    isMock: false
                                });
                                if (stats.requestsLog.length > 50)
                                    stats.requestsLog.pop();
                            }
                        }
                        catch (parseErr) {
                            console.error('[yakushield] Failed to parse response usage:', parseErr);
                        }
                    });
                });
                clientReq.on('error', (err) => {
                    console.error('[yakushield] Proxy Error:', err);
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
                });
                clientReq.write(bodyData);
                clientReq.end();
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Request', message: err.message }));
            }
        });
        return;
    }
    // 5.5 OpenAI / Codex パススルー (chat/completions・responses) → api.openai.com
    if ((urlPath.endsWith('/chat/completions') || urlPath.endsWith('/responses')) && req.method === 'POST') {
        let bodyData = '';
        req.on('data', chunk => { bodyData += chunk; });
        req.on('end', () => {
            try {
                const body = JSON.parse(bodyData || '{}');
                const model = body.model || 'gpt-4o';
                const isStream = body.stream === true;
                const rate = getModelRate(model);
                // 入力テキスト抽出（chat: messages / responses: input）→ 日本語浪費推定
                let promptText = '';
                if (Array.isArray(body.messages)) {
                    for (const m of body.messages) {
                        if (typeof m.content === 'string')
                            promptText += m.content;
                        else if (Array.isArray(m.content))
                            for (const p of m.content) {
                                if (typeof p.text === 'string')
                                    promptText += p.text;
                            }
                    }
                }
                if (typeof body.input === 'string')
                    promptText += body.input;
                const wastedInputTokens = estimateJapaneseWastedTokens(promptText);
                // --- 物理予算ブレーカー（OpenAI形式エラーで返す） ---
                if (stats.todayCostUsd >= stats.dailyBudgetLimitUsd) {
                    stats.blockedRequests++;
                    stats.totalRequests++;
                    stats.requestsLog.unshift({ timestamp: new Date().toLocaleTimeString('ja-JP'), model: rate.name, inputTokens: 0, outputTokens: 0, costUsd: 0, wastedCostUsd: 0, status: 'blocked', isMock: false });
                    if (stats.requestsLog.length > 50)
                        stats.requestsLog.pop();
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: `yakushield [物理予算ブレーカー作動]: 1日の上限予算 ($${stats.dailyBudgetLimitUsd.toFixed(2)}) を超過したため遮断しました。ダッシュボード (http://localhost:${PORT}) で上限を変更できます。`, type: 'over_budget_error', code: 'over_budget' } }));
                    return;
                }
                // 認証キー: リクエストの Authorization か OPENAI_API_KEY
                const authHeader = req.headers['authorization'] || (process.env.OPENAI_API_KEY ? `Bearer ${process.env.OPENAI_API_KEY}` : '');
                if (!authHeader) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'yakushield: OpenAI APIキーがありません（Authorization ヘッダ or OPENAI_API_KEY）。', type: 'authentication_error' } }));
                    return;
                }
                const fwdPath = urlPath.endsWith('/responses') ? '/v1/responses' : '/v1/chat/completions';
                const options = { hostname: 'api.openai.com', path: fwdPath, method: 'POST', headers: { 'content-type': 'application/json', 'authorization': authHeader } };
                if (req.headers['openai-organization'])
                    options.headers['openai-organization'] = req.headers['openai-organization'];
                const clientReq = https.request(options, (clientRes) => {
                    res.writeHead(clientRes.statusCode || 200, clientRes.headers);
                    let buffer = '';
                    clientRes.on('data', (chunk) => { res.write(chunk); buffer += chunk.toString(); });
                    clientRes.on('end', () => {
                        res.end();
                        stats.totalRequests++;
                        try {
                            let inTok = 0, outTok = 0;
                            // chat: prompt_tokens/completion_tokens ／ responses: input_tokens/output_tokens ／ stream は正規表現で抽出
                            const pIn = buffer.match(/"(?:prompt_tokens|input_tokens)"\s*:\s*(\d+)/);
                            const pOutAll = [...buffer.matchAll(/"(?:completion_tokens|output_tokens)"\s*:\s*(\d+)/g)];
                            if (pIn)
                                inTok = parseInt(pIn[1], 10);
                            if (pOutAll.length > 0)
                                outTok = parseInt(pOutAll[pOutAll.length - 1][1], 10);
                            if (inTok > 0 || outTok > 0) {
                                const cost = (inTok * rate.input) + (outTok * rate.output);
                                const finalWasted = Math.min(wastedInputTokens, inTok);
                                const wastedCost = finalWasted * rate.input;
                                stats.todayCostUsd = parseFloat((stats.todayCostUsd + cost).toFixed(6));
                                stats.todayInputTokens += inTok;
                                stats.todayOutputTokens += outTok;
                                stats.japaneseWastedTokens += finalWasted;
                                stats.japaneseWastedCostUsd = parseFloat((stats.japaneseWastedCostUsd + wastedCost).toFixed(6));
                                stats.requestsLog.unshift({ timestamp: new Date().toLocaleTimeString('ja-JP'), model: rate.name, inputTokens: inTok, outputTokens: outTok, costUsd: parseFloat(cost.toFixed(6)), wastedCostUsd: parseFloat(wastedCost.toFixed(6)), status: 'success', isMock: false });
                                if (stats.requestsLog.length > 50)
                                    stats.requestsLog.pop();
                            }
                        }
                        catch (e) {
                            console.error('[yakushield] OpenAI usage parse error:', e);
                        }
                    });
                });
                clientReq.on('error', (err) => { console.error('[yakushield] OpenAI Proxy Error:', err); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: err.message, type: 'bad_gateway' } })); });
                clientReq.write(bodyData);
                clientReq.end();
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: err.message, type: 'invalid_request_error' } }));
            }
        });
        return;
    }
    // 6. それ以外の未知のルート
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
});
// ----------------------------------------------------
// Server Startup
// ----------------------------------------------------
server.listen(PORT, () => {
    console.log('\x1b[35m%s\x1b[0m', `
  __   __      _        ____  _     _      _     _ 
  \\ \\ / /_ _  | | __   / ___|| |__ (_) ___| | __| |
   \\ V / _\` | | |/ /   \\___ \\| '_ \\| |/ _ \\ |/ _\` |
    | | (_| | |   <     ___) | | | | |  __/ | (_| |
    |_|\\__,_| |_|\\_\\   |____/|_| |_|_|\\___|_|\\__,_|
  `);
    console.log('\x1b[32m%s\x1b[0m', `  🛡️  yakushield (訳シールド) ローカルプロキシ起動完了`);
    console.log('----------------------------------------------------');
    console.log(`  🔗  Dashboard UI:   \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
    console.log(`  🔌  LLM Base URL:   \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
    console.log('----------------------------------------------------');
    if (process.env.ANTHROPIC_API_KEY) {
        console.log(`  🔑  APIキー検出:    Anthropic APIキーを読み込みました (透過中継モード)`);
    }
    else {
        console.log(`  🧪  APIキー未検出:  \x1b[33mスタブ/モックモードで動作中\x1b[0m (APIキー不要でテスト可能)`);
        console.log(`                     本番中継は .env の ANTHROPIC_API_KEY にキーを設定してください。`);
    }
    console.log('----------------------------------------------------\n');
    // --- ワンコマンド・ラッパー: `yakushield claude` / `yakushield codex` / `yakushield <cmd...>` ---
    // 引数があれば、プロキシ起動後にエージェントを正しい BASE_URL 環境変数付きで起動する（手動 export 不要）。
    const agentArgs = process.argv.slice(2).filter(a => a !== '--');
    if (agentArgs.length > 0) {
        const cmd = agentArgs[0];
        const childArgs = agentArgs.slice(1);
        const env = { ...process.env };
        if (cmd === 'codex') {
            env.OPENAI_BASE_URL = `http://localhost:${PORT}/v1`;
        }
        else if (cmd === 'claude') {
            env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}`;
        }
        else {
            env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}`;
            env.OPENAI_BASE_URL = `http://localhost:${PORT}/v1`;
        }
        console.log('\x1b[35m%s\x1b[0m', `  🔌  ${cmd} を YakuShield 経由で起動します（予算ブレーカー＋計測ON・手動設定不要）...\n`);
        const child = spawn(cmd, childArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
        child.on('error', (e) => { console.error('\x1b[31m%s\x1b[0m', `  ✖ ${cmd} を起動できませんでした: ${e.message}`); server.close(); process.exit(1); });
        child.on('exit', (code) => { server.close(); process.exit(code ?? 0); });
    }
});
