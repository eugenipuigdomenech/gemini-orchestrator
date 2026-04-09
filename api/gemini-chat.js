import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// LES TEVES URLS DELS ALTRES PROJECTES (Canvia-les per les reals)
const URL_DRIVE = "https://drive-knowledge-bridge.vercel.app/api/ask-knowledge";
const URL_SHEETS = "https://gpt-sheets-logger.vercel.app/api/log-unresolved";

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
      model: "gemini-flash-latest",
      systemInstruction: `Ets el Chatbot ${chatbot.toUpperCase()} de l'ESEIAAT. 
      Respon en l'idioma de l'usuari (preferentment català). 
      Utilitza ÚNICAMENT la informació obtinguda de l'eina askKnowledge. 
      Si la informació no és suficient o la pregunta no està relacionada, crida SEMPRE a logUnresolvedQuestion i demana disculpes a l'usuari dient que no tens aquesta informació.`,
      tools: tools,
    });

   const chatSession = model.startChat();
    let result = await chatSession.sendMessage(message);

    // Canviem l'if per un while per gestionar múltiples crides seguides (ex: askKnowledge i després logUnresolved)
    let call = result.response.functionCalls()?.[0];

    while (call) {
      let functionResponseData = {};
      console.log(`[Gemini] Cridant projecte extern: ${call.name}`);

      if (call.name === "askKnowledge") {
        const fetchRes = await fetch(URL_DRIVE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(call.args),
        });
        functionResponseData = await fetchRes.json();
      } 
      else if (call.name === "logUnresolvedQuestion") {
        const fetchRes = await fetch(URL_SHEETS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...call.args, source: "gemini_api" }),
        });
        functionResponseData = await fetchRes.json();
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