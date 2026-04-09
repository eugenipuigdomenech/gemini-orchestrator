import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// LES TEVES URLS DELS ALTRES PROJECTES (Canvia-les per les reals)
const URL_DRIVE = "https://drive-knowledge-bridge.vercel.app/api/ask-knowledge";
const URL_SHEETS = "https://gpt-sheets-logger-ten.vercel.app/api/log-unresolved";

const tools = [
  {
    functionDeclarations: [
      {
        name: "askKnowledge",
        description: "Cerca informació rellevant a la base de dades (Drive) per respondre l'usuari.",
        parameters: {
          type: "object",
          properties: {
            chatbot: { type: "string", description: "L'àmbit del chatbot: tfe, mobilitat o practiques" },
            query: { type: "string", description: "La pregunta de l'usuari formulada per cercar" }
          },
          required: ["chatbot", "query"]
        }
      },
      {
        name: "logUnresolvedQuestion",
        description: "Registra la pregunta quan la consulta no es pot respondre o està fora d'àmbit.",
        parameters: {
          type: "object",
          properties: {
            chatbot: { type: "string" },
            question: { type: "string", description: "La pregunta exacta de l'usuari" },
            user_language: { type: "string" },
            context_hint: { type: "string", description: "Resum molt breu (2-4 paraules)" },
            source: { type: "string", description: "Sempre ha de ser 'gemini_api'" },
            status: { type: "string", description: "Sempre ha de ser 'unresolved'" }
          },
          required: ["chatbot", "question", "user_language", "context_hint", "source", "status"]
        }
      }
    ]
  }
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Mètode no permès" });

  try {
    const { chatbot, message } = req.body;

    if (!chatbot || !message) {
      return res.status(400).json({ error: "Falten paràmetres (chatbot i message)" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-pro-latest",
      systemInstruction: `Ets el Chatbot ${chatbot.toUpperCase()} de l'Escola Superior d'Enginyeries Industrial, Aeroespacial i Audiovisual de Terrassa (ESEIAAT - UPC).

Missió:
Ajudar els estudiants a resoldre dubtes relacionats amb l'àmbit de ${chatbot.toUpperCase()} (procediments, tràmits, normativa, terminis, etc.).

Idioma:
Respon preferentment en català, de manera clara, propera, amable i motivadora. Si l’usuari et demana un altre idioma, respon en aquell idioma.

Coneixement i Normes de resposta:
- Utilitza ÚNICAMENT la informació obtinguda a través de l'eina "askKnowledge".
- No inventis cap resposta, dada ni termini. No utilitzis coneixement general extern.
- Només pots respondre preguntes relacionades amb ${chatbot.toUpperCase()}. No responguis preguntes d'altres temes.
- No reformulis la pregunta de l’usuari abans d’enviar-la a l'eina.

PROTOCOL OBLIGATORI DE RESPOSTA (PAS A PAS):
1. Comprova si la pregunta sembla relacionada amb l'àmbit acadèmic.
2. Crida l'eina "askKnowledge" enviant el chatbot ("${chatbot.toLowerCase()}") i la query (la pregunta exacta de l'usuari).
3. Analitza els resultats de "askKnowledge":
   - ÈXIT: Si hi ha informació clara i suficient, formula la teva resposta final utilitzant NOMÉS aquesta informació.
   - FRACÀS: Si no hi ha resultats, la informació és insuficient, és ambigua, o no es pot respondre amb seguretat.
4. EN CAS DE FRACÀS (Molt Important):
   - NO tornis a cridar "askKnowledge" per segona vegada.
   - Crida Immediatament l'eina "logUnresolvedQuestion" per registrar la pregunta.
   - La teva resposta de text a l'usuari ha de ser EXACTAMENT i únicament aquesta: "No tinc aquesta informació. Et recomano que contactis amb el servei o canal de suport corresponent de l’ESEIAAT."`,
      tools: tools,
    });

    const chatSession = model.startChat();
    let result = await chatSession.sendMessage(message);

    let call = result.response.functionCalls()?.[0];
    
    // 🔴 AFEGIM EL FRE D'EMERGÈNCIA AQUÍ:
    let voltes = 0;
    const MAX_VOLTES = 3; 

    while (call && voltes < MAX_VOLTES) { // 👈 Afegim la condició al while
      voltes++; // 👈 Sumem 1 a cada volta
      let functionResponseData = {};
      console.log(`[Gemini] Volta ${voltes}: Cridant projecte extern: ${call.name}`);

if (call.name === "askKnowledge") {
        const fetchRes = await fetch(URL_DRIVE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(call.args),
        });
        
        // 🔴 Llegim la resposta com a text primer per si és un error HTML de Vercel
        const rawText = await fetchRes.text();
        try {
          functionResponseData = JSON.parse(rawText);
          console.log("[XIVATO DRIVE] Dades rebudes OK");
        } catch (err) {
          console.error(`[ERROR FATAL DRIVE] L'API de Drive ha retornat un error o HTML en lloc de JSON: ${rawText.substring(0, 100)}`);
          functionResponseData = { error: "No s'ha pogut connectar amb la base de dades" };
        }
      } 
      else if (call.name === "logUnresolvedQuestion") {
        const fetchRes = await fetch(URL_SHEETS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...call.args, source: "gemini_api" }),
        });
        
        // 🔴 Fem el mateix aquí
        const rawText = await fetchRes.text();
        try {
          functionResponseData = JSON.parse(rawText);
        } catch (err) {
          console.error(`[ERROR FATAL SHEETS] L'API de Sheets ha retornat un error o HTML en lloc de JSON: ${rawText.substring(0, 100)}`);
          functionResponseData = { error: "No s'ha pogut guardar el registre" };
        }
      }

      // 🔴 TRUC DE SEGURETAT: Gemini EXIGEIX que 'response' sigui un objecte JSON. 
      // Si la teva API retornés un string, això ho arregla perquè no falli.
      if (typeof functionResponseData !== 'object') {
        functionResponseData = { data: functionResponseData };
      }

      console.log(`[Vercel] Enviant dades de ${call.name} de tornada a Gemini...`);

      // Retornem la info de Vercel a Gemini
      result = await chatSession.sendMessage([{
        functionResponse: {
          name: call.name,
          response: functionResponseData
        }
      }]);

      // Tornem a comprovar si Gemini vol fer una ALTRA crida abans de respondre
      call = result.response.functionCalls()?.[0];
    }

    // Quan el while acaba, significa que Gemini ja no crida més eines i ens ha donat un text definitiu.
    // L'enviem al Postman/Frontend!
    
    // Per si de cas, comprovem que realment hi hagi text
    let textDefinitiu = "";
    try {
      textDefinitiu = result.response.text();
    } catch (e) {
      textDefinitiu = "Ho sento, hi ha hagut un error processant la informació final.";
      console.error("Error extraient text:", e);
    }

    return res.status(200).json({
      success: true,
      reply: textDefinitiu
    });

  } catch (error) {
    console.error("Error Orchestrator:", error);
    return res.status(500).json({ error: "Error intern", details: error.message });
  }
}