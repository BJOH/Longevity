// Analyserar en matbild eller fritextbeskrivning med Claude och returnerar
// en strukturerad näringsuppskattning för hela portionen.
// Kräver hemligheten ANTHROPIC_API_KEY (Edge Functions → Secrets).
import Anthropic from 'npm:@anthropic-ai/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const TOOL = {
  name: 'rapportera_analys',
  description: 'Rapportera näringsuppskattningen för portionen.',
  input_schema: {
    type: 'object' as const,
    required: ['namn', 'gram', 'kcal', 'fett', 'kolh', 'protein', 'sakerhet'],
    properties: {
      namn: { type: 'string', description: 'Kort svenskt namn på rätten/livsmedlet, t.ex. "Lax med broccoli"' },
      gram: { type: 'number', description: 'Uppskattad total portionsvikt i gram' },
      kcal: { type: 'number', description: 'Kalorier för hela portionen (inte per 100 g)' },
      fett: { type: 'number', description: 'Fett i gram för hela portionen' },
      kolh: { type: 'number', description: 'Kolhydrater i gram för hela portionen' },
      protein: { type: 'number', description: 'Protein i gram för hela portionen' },
      fiber: { type: 'number', description: 'Fiber i gram för hela portionen' },
      beskrivning: { type: 'string', description: 'Kort lista över vad som identifierats och antaganden' },
      sakerhet: { type: 'string', enum: ['låg', 'medel', 'hög'], description: 'Hur säker uppskattningen är' },
    },
  },
};

const SYSTEM = `Du är en noggrann nutritionist. Uppskatta näringsinnehållet i det som
beskrivs eller syns på bilden. Bedöm portionsstorleken utifrån visuella ledtrådar
(tallrikens storlek, bestick, förpackningar); i text utan mängdangivelser: utgå
från svenska standardportioner (t.ex. 1 ägg 60 g, 1 skiva bröd 35 g, 1 msk olja
10 g). Räkna med dolt fett (matlagningsolja, smör, såser). Var konsekvent —
samma beskrivning ska alltid ge samma uppskattning; gissa mittenvärdet, inte
högt eller lågt. Ange totalvärden för HELA portionen, inte per 100 g. Svara på
svenska. Om bilden inte innehåller mat: sätt namn till "Ingen mat hittad",
alla värden till 0 och sakerhet till "låg".`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metod' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'saknar_nyckel' }, 200);

  let body: { image?: string; mediaType?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'ogiltig_json' }, 400);
  }
  if (!body.image && !body.text) return json({ error: 'tom_forfragan' }, 400);

  const content: Anthropic.MessageParam['content'] = [];
  if (body.image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: (body.mediaType || 'image/jpeg') as 'image/jpeg',
        data: body.image,
      },
    });
  }
  content.push({
    type: 'text',
    text: body.text
      ? `Uppskatta näringsinnehållet: ${body.text}`
      : 'Uppskatta näringsinnehållet i maten på bilden.',
  });

  const client = new Anthropic({ apiKey });
  // Sonnet 5 först (klart bättre bildidentifiering), Haiku som reserv så
  // att funktionen aldrig blir obrukbar om ett modellanrop avvisas.
  const MODELS = ['claude-sonnet-5', 'claude-haiku-4-5'];
  const fel: string[] = [];
  for (const model of MODELS) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 1024,
        // temperature 0: samma indata ger samma uppskattning
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'rapportera_analys' },
      });
      const block = msg.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') return json({ error: 'inget_svar' }, 502);
      // Diagnostik i svaret: vilken modell som svarade + ev. tidigare fel
      const out = block.input as Record<string, unknown>;
      const extra = [`modell: ${model}`, ...fel];
      out.beskrivning = `${out.beskrivning || ''} [${extra.join(' · ')}]`;
      return json(out);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      fel.push(`${model} avvisades (${e.status}): ${(e.message || '').slice(0, 300)}`);
      console.error(`analyze-food [${model}]:`, e.status, e.message);
      if (e.status === 401) return json({ error: 'nyckel_ogiltig' }, 200);
      if (e.status === 429) return json({ error: 'for_manga_anrop' }, 200);
      // 400/404 = modellen/parametern avvisades — prova nästa modell
    }
  }
  return json({ error: 'analys_misslyckades', detalj: fel.join(' · ') }, 502);
});
