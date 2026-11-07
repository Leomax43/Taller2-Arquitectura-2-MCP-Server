# HardwareGuru - MCP Server (Inteligencia Artificial)

Microservicio intermedio de **HardwareGuru** (Repositorio 2 de 7). Este servicio actúa como el "cerebro" de la plataforma, utilizando el **Model Context Protocol (MCP)** y la API de **Google Gemini** para interpretar las solicitudes en lenguaje natural de los usuarios, extraer parámetros técnicos y orquestar llamadas a otros microservicios.

## 🚀 Arquitectura y Flujo

Este servicio opera como un puente entre el usuario (o el API Gateway) y el motor matemático (Java):
1. **Recibe** un prompt en lenguaje natural a través de un endpoint REST (`POST /chat`).
2. **Analiza** el prompt usando el modelo `gemini-3.8-flash`.
3. **Extrae** variables técnicas (TDP, puntajes PassMark, resolución) si detecta que el usuario necesita una simulación de rendimiento.
4. **Consulta** al **Repositorio 1 (Simulador)** mediante **gRPC** en el puerto `9090` para realizar los cálculos matemáticos exactos (consumo y cuello de botella).
5. **Redacta** una respuesta final amigable y la devuelve en formato JSON.

## 🛠️ Tecnologías

* **Entorno:** Node.js + TypeScript (ESM Modules)
* **Framework Web:** Express.js
* **Inteligencia Artificial:** Google Generative AI SDK (`gemini-3.8-flash`)
* **Integración de Herramientas:** Model Context Protocol (MCP) SDK + Zod
* **Comunicación Interna:** gRPC (`@grpc/grpc-js`, `@grpc/proto-loader`)

## 📋 Requisitos Previos

Antes de ejecutar este proyecto, asegúrate de tener:
* **Node.js** (v18 o superior).
* Una **API Key de Google Gemini** (Google AI Studio).
* El **Repositorio 1 (Simulador Java)** ejecutándose localmente en el puerto `9090`.

## ⚙️ Instalación y Configuración

1. **Clonar el repositorio y entrar a la carpeta:**
   
```bash
   git clone <tu-url-del-repo-2>
   cd Taller2-Arquitectura-2-MCP-Server




Instalar las dependencias:

Bash
   npm install
   
Configurar variables de entorno:
Crea un archivo .env en la raíz del proyecto y agrega tu clave de Gemini:

Fragmento de código
   GEMINI_API_KEY=tu_api_key_aqui
   PORT=3000
   
▶️ Ejecución
Para iniciar el servidor en modo desarrollo (con recarga automática gracias a Nodemon y TSX):

Bash
npm run dev
Verás en la consola que el servidor se levanta en el puerto 3000 (o el definido en tu .env).

🌐 Endpoints y Uso
El servicio expone un único endpoint REST principal:

POST /chat
Recibe la consulta del usuario y devuelve el análisis de la IA.

Body de la petición (JSON):

JSON
{
  "prompt": "Simula el rendimiento para un PC 1080p con fuente de 500W. La CPU consume 65W (score 5000) y la GPU consume 200W (score 20000)."
}
Ejemplo de llamada con cURL:

DOS
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"prompt\":\"Simula el rendimiento para un PC 1080p con fuente de 500W. La CPU consume 65W (score 5000) y la GPU consume 200W (score 20000).\"}"
Ejemplo de respuesta (JSON):

JSON
{
  "respuesta": "¡Hola! Hemos realizado la simulación para tu configuración a 1080p con fuente de 500W y aquí tienes los resultados obtenidos:\n\n* **Consumo total estimado:** 378W\n* **Cuello de botella:** 75%\n* **Estado:** En riesgo..."
}
📁 Estructura del Proyecto
Plaintext
Taller2-Arquitectura-2-MCP-Server/
├── src/
│   ├── proto/
│   │   └── simulator.proto    # Contrato gRPC compartido con el Repo 1
│   └── index.ts               # Lógica principal del servidor, MCP y Gemini
├── .env                       # Variables de entorno (Oculto en Git)
├── .gitignore                 # Archivos ignorados por Git
├── package.json               # Dependencias y scripts
└── tsconfig.json              # Configuración de TypeScript

