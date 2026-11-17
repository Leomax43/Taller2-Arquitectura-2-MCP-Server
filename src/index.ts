import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns'; // <-- LIBRERÍA DE RED NATIVA

// Forzar a Node.js a usar IPv4 para evitar micro-cortes (fetch failed)
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
    console.error("CRÍTICO: No se encontró GEMINI_API_KEY en el archivo .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const mcpServer = new McpServer({
  name: "HardwareGuru-MCP",
  version: "1.0.0"
});

// ==========================================
// CONFIGURACIÓN CLIENTE gRPC
// ==========================================
// Obtener __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar el archivo .proto
const PROTO_PATH = path.join(__dirname, 'proto', 'simulator.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const simulatorProto = protoDescriptor.simulator;

// Conectar al servidor Java en el puerto 9090
const grpcClient = new simulatorProto.SimulatorService(
    'localhost:9090', 
    grpc.credentials.createInsecure()
);

// Función que envuelve la llamada gRPC en una Promesa
function simularRendimientoGrpc(args: any, userId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Agregamos el user_id al objeto que viaja a Java
        const grpcPayload = {
            ...args,
            user_id: userId
        };

        grpcClient.SimularRendimiento(grpcPayload, (error: any, response: any) => {
            if (error) {
                console.error("Error en gRPC:", error);
                reject(error);
            } else {
                resolve(`Resultado: Consumo=${response.consumo_total_watts}W, Cuello=${response.cuello_botella_porcentaje}%, Estado=${response.estado}, Motivo=${response.motivo}`);
            }
        });
    });
}





// ==========================================
// ENDPOINT REST PARA EL BFF (CON DEBUGGING Y STATELESS)
// ==========================================
app.post('/chat', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "El prompt es requerido" });

        // 1. Capturamos el ID del usuario desde los headers (lo enviará el API Gateway)
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: "No autorizado. Falta el header x-user-id" });


        
        console.log(`\n--- NUEVA PETICIÓN RECIBIDA de User ID: ${userId} ---`);
        console.log(`[Paso 1] Analizando la pregunta del usuario: "${prompt}"...`);

        // Llamada 1: Solo para extraer las variables (Sin mantener sesión viva)
        const response1 = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            tools: [{
                functionDeclarations: [{
                    name: "simular_rendimiento_hardwareguru",
                    description: "Calcula el consumo total en Watts y el cuello de botella (%) entre CPU y GPU.",
                    parameters: {
                      type: SchemaType.OBJECT,
                      properties: {
                        cpu_tdp_watts: { type: SchemaType.NUMBER, description: "Consumo TDP de la CPU" },
                        cpu_benchmark_score: { type: SchemaType.NUMBER, description: "Puntaje PassMark de la CPU" },
                        gpu_tdp_watts: { type: SchemaType.NUMBER, description: "Consumo TDP de la GPU" },
                        gpu_benchmark_score: { type: SchemaType.NUMBER, description: "Puntaje PassMark de la GPU" },
                        resolucion: { type: SchemaType.STRING, description: "Resolución: '1080p' o '1440p'" },
                        psu_watts: { type: SchemaType.NUMBER, description: "Capacidad de la fuente en Watts" }
                      },
                      required: ["cpu_tdp_watts", "cpu_benchmark_score", "gpu_tdp_watts", "gpu_benchmark_score", "resolucion", "psu_watts"]
                    }
                }]
            }]
        });

        const functionCalls = response1.response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0]!;
            if (call.name === "simular_rendimiento_hardwareguru") {
                console.log(`[Paso 2] IA decidió usar la herramienta. Variables extraídas correctamente.`);
                
                // Ejecutamos la petición gRPC
                console.log(`[Paso 3] Iniciando comunicación gRPC con Repositorio 1 (Java)...`);
                const toolResultText = await simularRendimientoGrpc(call.args, userId as string);
                console.log(`[Paso 4] gRPC finalizado con éxito. Resultado: ${toolResultText}`);
                
                // Llamada 2: Nueva petición limpia a Gemini solo para redactar, uniendo pregunta y resultado.
                console.log(`[Paso 5] Enviando resultados a Gemini para redactar respuesta final...`);
                const promptFinal = `El usuario hizo esta pregunta: "${prompt}". 
                Nuestros sistemas matemáticos calcularon exactamente esto: ${toolResultText}. 
                Por favor, redacta una respuesta amigable, clara y directa al usuario entregándole los resultados matemáticos sin inventar datos.`;
                
                const finalResult = await model.generateContent(promptFinal);
                
                console.log(`[Paso 6] Respuesta final redactada por Gemini recibida con éxito.`);
                return res.json({ respuesta: finalResult.response.text() });
            }
        }
        
        console.log(`[Paso 2 Alternativo] La IA decidió responder directamente sin usar herramientas.`);
        res.json({ respuesta: response1.response.text() });

    } catch (error) {
        console.error("\n[ERROR CRÍTICO] Ocurrió un fallo en el proceso:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

app.listen(port, () => {
  console.log(`🧠 HardwareGuru MCP Server corriendo en http://localhost:${port}`);
});