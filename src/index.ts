import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const SIMULADOR_GRPC_URL = process.env.SIMULADOR_GRPC_URL || 'localhost:9090';
const SIMULADOR_REST_URL = process.env.SIMULADOR_REST_URL || 'http://localhost:8081';
const CATALOGO_GRPC_URL = process.env.CATALOGO_GRPC_URL || 'localhost:50051';

app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
    console.error("CRÍTICO: No se encontró GEMINI_API_KEY en el archivo .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 1. CLIENTES gRPC (SIMULADOR + CATÁLOGO)
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const protoOptions = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
};

// Cliente Simulador (Java :9090)
const simProtoPath = path.join(__dirname, 'proto', 'simulator.proto');
const simDescriptor = grpc.loadPackageDefinition(protoLoader.loadSync(simProtoPath, protoOptions)) as any;
const simulatorClient = new simDescriptor.simulator.SimulatorService(
    SIMULADOR_GRPC_URL,
    grpc.credentials.createInsecure()
);

// Cliente Catálogo (Go :50051)
const catProtoPath = path.join(__dirname, 'proto', 'hardware.proto');
const catDescriptor = grpc.loadPackageDefinition(protoLoader.loadSync(catProtoPath, protoOptions)) as any;
const catalogoClient = new catDescriptor.hardware.CatalogoService(
    CATALOGO_GRPC_URL,
    grpc.credentials.createInsecure()
);

// Helpers Promisificados para gRPC
const grpcCall = (client: any, method: string, payload: any): Promise<any> =>
    new Promise((resolve, reject) => {
        client[method](payload, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });

// Extrae un puntaje numérico desde benchmarks_json del catálogo (evitando 0 o NaN)
function extraerBenchmarkScore(benchmarksJson?: string): number {
    if (!benchmarksJson) return 10000;
    try {
        const parsed = JSON.parse(benchmarksJson);
        const clavesPrioritarias = ['passmark', 'score', 'benchmark', 'multi_core', 'timespy', 'puntuacion'];
        for (const clave of clavesPrioritarias) {
            if (typeof parsed[clave] === 'number' && parsed[clave] > 0) return Math.round(parsed[clave]);
        }
        // Si usa otra clave numérica, toma el primer número positivo que encuentre
        const primerNumero = Object.values(parsed).find((v) => typeof v === 'number' && v > 0) as number | undefined;
        return primerNumero ? Math.round(primerNumero) : 10000;
    } catch {
        return 10000;
    }
}

// ==========================================
// 2. DECLARACIÓN DE TOOLS PARA GEMINI
// ==========================================
const toolDeclarations = [
    {
        name: "listar_componentes",
        description: "Lista componentes del catálogo oficial de HardwareGuru. Permite filtrar por tipo y/o buscar por texto en el nombre o fabricante.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                tipo: { type: SchemaType.STRING, description: "Opcional: 'cpu', 'placa', 'ram', 'gpu' o 'fuente'. Dejar vacío para todos." },
                busqueda: { type: SchemaType.STRING, description: "Opcional: texto para filtrar por nombre o marca (ej. 'Ryzen', '5060', 'AM5')." }
            }
        }
    },
    {
        name: "obtener_specs_componente",
        description: "Obtiene especificaciones detalladas y benchmarks de un componente específico por su ID del catálogo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                id: { type: SchemaType.STRING, description: "ID exacto del componente en el catálogo." }
            },
            required: ["id"]
        }
    },
    {
        name: "verificar_compatibilidad",
        description: "Valida las 4 reglas técnicas (socket, tipo de RAM, ranuras de RAM y potencia de fuente) entre las piezas elegidas usando sus IDs del catálogo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cpu_id: { type: SchemaType.STRING, description: "ID del procesador" },
                motherboard_id: { type: SchemaType.STRING, description: "ID de la placa madre" },
                ram_id: { type: SchemaType.STRING, description: "ID de la memoria RAM" },
                psu_id: { type: SchemaType.STRING, description: "ID de la fuente de poder" },
                gpu_id: { type: SchemaType.STRING, description: "Opcional: ID de la tarjeta gráfica" },
                ram_cantidad: { type: SchemaType.NUMBER, description: "Cantidad de kits/módulos de RAM (por defecto 1)" }
            },
            required: ["cpu_id", "motherboard_id", "ram_id", "psu_id"]
        }
    },
    {
        name: "simular_build_por_ids",
        description: "Resuelve los TDP, potencia de fuente y benchmarks reales desde el catálogo usando los IDs y ejecuta el simulador matemático de rendimiento.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cpu_id: { type: SchemaType.STRING, description: "ID de la CPU en el catálogo" },
                gpu_id: { type: SchemaType.STRING, description: "ID de la GPU en el catálogo" },
                psu_id: { type: SchemaType.STRING, description: "ID de la fuente de poder en el catálogo" },
                resolucion: { type: SchemaType.STRING, description: "'1080p' o '1440p'" }
            },
            required: ["cpu_id", "gpu_id", "psu_id", "resolucion"]
        }
    },
    {
        name: "simular_rendimiento_manual",
        description: "Simula rendimiento cuando el usuario menciona piezas que NO están en el catálogo, pasando TDP y benchmarks estimados.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cpu_tdp_watts: { type: SchemaType.NUMBER, description: "Consumo TDP de la CPU" },
                cpu_benchmark_score: { type: SchemaType.NUMBER, description: "Puntaje PassMark de la CPU" },
                gpu_tdp_watts: { type: SchemaType.NUMBER, description: "Consumo TDP de la GPU" },
                gpu_benchmark_score: { type: SchemaType.NUMBER, description: "Puntaje PassMark de la GPU" },
                resolucion: { type: SchemaType.STRING, description: "'1080p' o '1440p'" },
                psu_watts: { type: SchemaType.NUMBER, description: "Potencia de la fuente en Watts" }
            },
            required: ["cpu_tdp_watts", "cpu_benchmark_score", "gpu_tdp_watts", "gpu_benchmark_score", "resolucion", "psu_watts"]
        }
    },
    {
        name: "listar_mis_builds",
        description: "Obtiene el historial de builds y simulaciones guardadas por el usuario actual para poder analizarlas o compararlas.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: "guardar_build",
        description: "Guarda una build armada y simulada en el historial del usuario.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                nombreBuild: { type: SchemaType.STRING, description: "Nombre descriptivo para la build" },
                cpuNombre: { type: SchemaType.STRING },
                placaMadreNombre: { type: SchemaType.STRING },
                ramNombre: { type: SchemaType.STRING },
                gpuNombre: { type: SchemaType.STRING },
                fuenteNombre: { type: SchemaType.STRING },
                cpuTdpWatts: { type: SchemaType.NUMBER },
                gpuTdpWatts: { type: SchemaType.NUMBER },
                psuWatts: { type: SchemaType.NUMBER },
                resolucion: { type: SchemaType.STRING, description: "'1080p' o '1440p'" },
                consumoTotalEstimado: { type: SchemaType.NUMBER },
                cuelloBotellaPorcentaje: { type: SchemaType.NUMBER },
                estadoRiesgo: { type: SchemaType.STRING, description: "'Óptimo', 'Desbalanceado' o 'Riesgo Crítico'" }
            },
            required: ["nombreBuild", "cpuNombre", "gpuNombre", "fuenteNombre", "cpuTdpWatts", "gpuTdpWatts", "psuWatts", "resolucion", "consumoTotalEstimado", "cuelloBotellaPorcentaje", "estadoRiesgo"]
        }
    }
];

// ==========================================
// 3. EJECUTOR DE TOOLS
// ==========================================
async function ejecutarTool(name: string, args: any, userId: string): Promise<any> {
    console.log(`🔧 Ejecutando tool [${name}] con args:`, args);

    try {
        switch (name) {
            case "listar_componentes": {
                const resp = await grpcCall(catalogoClient, 'ListarComponentes', { tipo: args?.tipo || '' });
                let lista = resp.componentes || [];
                if (args?.busqueda) {
                    const q = String(args.busqueda).toLowerCase();
                    lista = lista.filter((c: any) =>
                        c.nombre?.toLowerCase().includes(q) ||
                        c.fabricante?.toLowerCase().includes(q) ||
                        c.socket?.toLowerCase().includes(q)
                    );
                }
                return { total: lista.length, componentes: lista };
            }

            case "obtener_specs_componente": {
                return await grpcCall(catalogoClient, 'ObtenerSpecs', { id: args.id });
            }

            case "verificar_compatibilidad": {
                return await grpcCall(catalogoClient, 'VerificarCompatibilidad', {
                    build: {
                        cpu_id: args.cpu_id,
                        motherboard_id: args.motherboard_id,
                        ram_id: args.ram_id,
                        gpu_id: args.gpu_id || '',
                        psu_id: args.psu_id,
                        ram_cantidad: args.ram_cantidad || 1
                    }
                });
            }

            case "simular_build_por_ids": {
                const [cpu, gpu, psu] = await Promise.all([
                    grpcCall(catalogoClient, 'ObtenerSpecs', { id: args.cpu_id }),
                    grpcCall(catalogoClient, 'ObtenerSpecs', { id: args.gpu_id }),
                    grpcCall(catalogoClient, 'ObtenerSpecs', { id: args.psu_id })
                ]);

                const payloadSim = {
                    cpu_tdp_watts: cpu.tdp || 65,
                    cpu_benchmark_score: extraerBenchmarkScore(cpu.benchmarks_json),
                    gpu_tdp_watts: gpu.tdp || 150,
                    gpu_benchmark_score: extraerBenchmarkScore(gpu.benchmarks_json),
                    psu_watts: psu.potencia_w || 500,
                    resolucion: args.resolucion || '1080p',
                    user_id: userId
                };

                const simResp = await grpcCall(simulatorClient, 'SimularRendimiento', payloadSim);
                return {
                    piezas: { cpu: cpu.nombre, gpu: gpu.nombre, fuente: psu.nombre },
                    parametrosUsados: payloadSim,
                    simulacion: simResp
                };
            }

            case "simular_rendimiento_manual": {
                return await grpcCall(simulatorClient, 'SimularRendimiento', {
                    ...args,
                    user_id: userId
                });
            }

            case "listar_mis_builds": {
                const resp = await fetch(`${SIMULADOR_REST_URL}/api/simulador/builds/${encodeURIComponent(userId)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status} al consultar builds`);
                const builds = await resp.json();
                return { total: Array.isArray(builds) ? builds.length : 0, builds };
            }

            case "guardar_build": {
                const resp = await fetch(`${SIMULADOR_REST_URL}/api/simulador/builds`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-user-id': userId
                    },
                    body: JSON.stringify({ ...args, userId })
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status} al guardar build`);
                return await resp.json();
            }

            default:
                return { error: `Herramienta desconocida: ${name}` };
        }
    } catch (err: any) {
        console.error(`❌ Error en tool [${name}]:`, err.message || err);
        return { error: `No se pudo ejecutar ${name}: ${err.details || err.message || 'Error interno'}` };
    }
}

// ==========================================
// 4. MODELO CON SYSTEM INSTRUCTION + TOOLS
// ==========================================
const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: `Eres Guru, el asistente experto en hardware de HardwareGuru.
Reglas obligatorias:
1. Cuando el usuario pida armar una PC, buscar piezas o preguntar por compatibilidad, usa primero 'listar_componentes' para trabajar con piezas REALES del catálogo.
2. Antes de recomendar una build completa, valida las piezas con 'verificar_compatibilidad' y calcula rendimiento real con 'simular_build_por_ids'.
3. Si el usuario pregunta por sus builds guardadas o quiere analizarlas, usa 'listar_mis_builds'.
4. Solo usa 'guardar_build' si el usuario pide explícitamente guardar la configuración.
5. Si una pieza no existe en el catálogo, puedes usar 'simular_rendimiento_manual' como respaldo, aclarándole al usuario que son valores estimados.
6. Responde siempre en español, de forma clara, directa y sin inventar datos técnicos.`,
    tools: [{ functionDeclarations: toolDeclarations as any }]
});

// ==========================================
// 5. ENDPOINT /chat CON BUCLE DE AGENTE
// ==========================================
app.post('/chat', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "El prompt es requerido" });

        const userId = String(req.headers['x-user-id'] || '');
        if (!userId) return res.status(401).json({ error: "No autorizado. Falta el header x-user-id" });

        console.log(`\n--- NUEVA PETICIÓN de User ID: ${userId} ---`);
        console.log(`Prompt: "${prompt}"`);

        const chat = model.startChat();
        let result = await chat.sendMessage(prompt);

        // Bucle agéntico: permite a Gemini encadenar hasta 8 llamadas de herramientas
        let iteraciones = 0;
        const MAX_ITERACIONES = 8;

        while (iteraciones < MAX_ITERACIONES) {
            const functionCalls = result.response.functionCalls();
            if (!functionCalls || functionCalls.length === 0) {
                break;
            }

            iteraciones++;
            console.log(`[Iteración ${iteraciones}] Gemini solicitó ${functionCalls.length} tool(s).`);

            const functionResponses = [];
            for (const call of functionCalls) {
                const toolData = await ejecutarTool(call.name, call.args, userId);
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: { resultado: toolData }
                    }
                });
            }

            result = await chat.sendMessage(functionResponses);
        }

        const textoFinal = result.response.text();
        console.log(`✅ Respuesta final enviada (${iteraciones} iteraciones de tools).`);
        return res.json({ respuesta: textoFinal });

    } catch (error) {
        console.error("\n[ERROR CRÍTICO] Ocurrió un fallo en /chat:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

app.listen(port, () => {
    console.log(`🧠 HardwareGuru MCP Server corriendo en http://localhost:${port}`);
    console.log(`   -> Simulador gRPC: ${SIMULADOR_GRPC_URL} | REST: ${SIMULADOR_REST_URL}`);
    console.log(`   -> Catálogo gRPC:  ${CATALOGO_GRPC_URL}`);
});