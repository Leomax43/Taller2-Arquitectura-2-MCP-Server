# HardwareGuru - MCP Server (Agente de Inteligencia Artificial)

Microservicio de IA de **HardwareGuru** (Repositorio 2). Actúa como el asistente experto (**Guru**) de la plataforma utilizando **Google Gemini** con *Function Calling* (inspirado en herramientas MCP) para interpretar consultas en lenguaje natural, consultar el catálogo oficial, verificar compatibilidad, ejecutar simulaciones matemáticas y gestionar el historial de builds de cada usuario.

> Proyecto universitario · Curso de Microservicios · Repo 2 de 7

---

## 1. Arquitectura y Flujo Agéntico

El servicio recibe peticiones desde el **API Gateway (NestJS)** en `POST /chat` y ejecuta un bucle agéntico (hasta **8 iteraciones** encadenadas) orquestando llamadas internas a otros microservicios:

1. **Autenticación y Aislamiento:** Exige el header `x-user-id` (inyectado por el API Gateway tras validar el JWT) para aislar el historial y las acciones de cada usuario. La `GEMINI_API_KEY` reside exclusivamente en el servidor y nunca se expone al cliente.
2. **Razonamiento con Gemini:** Envía el prompt del usuario junto con las instrucciones del sistema y la declaración de **7 herramientas**.
3. **Orquestación Interna:**
   * **Catálogo (Go, gRPC `:50051`):** Búsqueda de piezas, obtención de especificaciones/benchmarks y verificación de compatibilidad técnica.
   * **Simulador (Java, gRPC `:9090` y REST `:8081`):** Cálculo de consumo energético y cuello de botella, listado y guardado de builds.
4. **Respuesta Final:** Redacta una recomendación clara en español basada únicamente en datos reales de los microservicios y la devuelve en JSON.

---

## 2. Herramientas (Tools) Disponibles para el Agente

| Herramienta | Microservicio Destino | Protocolo | Descripción |
| :--- | :--- | :---: | :--- |
| `listar_componentes` | Catálogo (`:50051`) | gRPC | Lista componentes oficiales filtrando por `tipo` (`cpu`, `placa`, `ram`, `gpu`, `fuente`) y/o texto de búsqueda. |
| `obtener_specs_componente` | Catálogo (`:50051`) | gRPC | Obtiene especificaciones detalladas y `benchmarks_json` de una pieza por su ID. |
| `verificar_compatibilidad` | Catálogo (`:50051`) | gRPC | Valida las 4 reglas técnicas (socket, tipo de RAM, ranuras de RAM y potencia de fuente). |
| `simular_build_por_ids` | Catálogo (`:50051`) + Simulador (`:9090`) | gRPC | Resuelve TDP, fuente y puntajes reales desde el catálogo y ejecuta `SimularRendimiento`. |
| `simular_rendimiento_manual` | Simulador (`:9090`) | gRPC | Respaldo para simular piezas fuera del catálogo usando TDP y benchmarks estimados. |
| `listar_mis_builds` | Simulador (`:8081`) | REST | Consulta el historial de builds guardadas del usuario autenticado (`x-user-id`). |
| `guardar_build` | Simulador (`:8081`) | REST | Guarda una build armada y simulada en el historial del usuario cuando este lo solicita. |

---

## 3. Tecnologías y Requisitos Previos

* **Entorno:** Node.js (v20+) + TypeScript (ES Modules)
* **Framework Web:** Express.js 5 + CORS
* **Inteligencia Artificial:** `@google/generative-ai` (`GEMINI_MODEL`, por defecto `gemini-3-flash-preview`)
* **Comunicación Interna:** gRPC (`@grpc/grpc-js`, `@grpc/proto-loader`) y HTTP (`fetch`)
* **Testing y Cobertura:** Vitest + Supertest + `@vitest/coverage-v8`
* **Contenedores y CI/CD:** Docker (multi-stage) y GitHub Actions

---

## 4. Instalación y Configuración

1. **Clonar el repositorio e instalar dependencias:**
   ```bash
   git clone https://github.com/Leomax43/Taller2-Arquitectura-2-MCP-Server.git
   cd "Taller2-Arquitectura-2-MCP Server"
   npm install
   ```

2. **Configurar variables de entorno:**
   Copia `.env.example` a `.env` en la raíz del proyecto y completa tu clave de Google AI Studio:
   ```env
   PORT=3001
   GEMINI_API_KEY=tu_api_key_de_gemini
   GEMINI_MODEL=gemini-3-flash-preview
   SIMULADOR_GRPC_URL=localhost:9090
   SIMULADOR_REST_URL=http://localhost:8081
   CATALOGO_GRPC_URL=localhost:50051
   ```

3. **Iniciar el servidor en desarrollo:**
   ```bash
   npm run dev
   ```
   El servicio quedará escuchando en **`http://localhost:3001`**.

---

## 5. Contrato de la API REST

### `POST /chat`
Recibe el mensaje del usuario y retorna la respuesta procesada por el agente.

* **Headers obligatorios:**
  * `Content-Type: application/json`
  * `x-user-id: <id_del_usuario>`
* **Body (JSON):**
  ```json
  {
    "prompt": "Ármame una PC gamer para 1440p usando piezas del catálogo y verifica compatibilidad."
  }
  ```
* **Ejemplo con `curl`:**
  ```bash
  curl -X POST http://localhost:3001/chat \
    -H "Content-Type: application/json" \
    -H "x-user-id: 3" \
    -d "{\"prompt\":\"¿Qué builds tengo guardadas?\"}"
  ```
* **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "respuesta": "Tienes 1 build guardada en tu historial..."
  }
  ```
* **Errores:**
  * `400 Bad Request`: Falta el campo `prompt`.
  * `401 Unauthorized`: Falta el header `x-user-id`.
  * `500 Internal Server Error`: Error inesperado al comunicarse con Gemini.

---

## 6. Tests, Cobertura, Docker y CI/CD

### Pruebas Unitarias y de Integración (Vitest + Supertest)
La suite de pruebas (`tests/index.test.ts`) valida el parser de benchmarks (`extraerBenchmarkScore`), las 7 herramientas del agente (`ejecutarTool`), el manejo defensivo de errores y el bucle agéntico de `POST /chat` mockeando gRPC, `fetch` y Gemini sin consumir cuota real de la API:

```bash
# Ejecutar tests
npm test

# Ejecutar tests con reporte de cobertura
npm run test:coverage
```

* **Cobertura actual:** **92.72%** en statements, **94.11%** en líneas y **73.75%** en ramas (superando el umbral mínimo del 60%).
* **Reporte HTML:** Se genera localmente en `coverage/index.html` (ignorado en Git).

### Construcción de Imagen Docker
El `Dockerfile` utiliza un build *multi-stage* sobre `node:20-alpine` que compila TypeScript, copia los contratos `.proto` a `dist/proto` y genera una imagen liviana de producción exponiendo el puerto `3001`:

```bash
docker build -t hardwareguru-mcp-server:latest .
```

### Pipeline CI/CD (GitHub Actions)
Definido en `.github/workflows/ci.yml`. En cada `push` o `pull_request` hacia `main`, `master` o `develop`, el pipeline configura Node.js 20, instala dependencias (`npm ci`), ejecuta `npm run test:coverage` en modo test, compila TypeScript (`npm run build`) y valida la construcción de la imagen Docker.

---

## 7. Estructura del Proyecto

```text
Taller2-Arquitectura-2-MCP Server/
├── .github/
│   └── workflows/
│       └── ci.yml                   # Pipeline CI/CD (tests + build + Docker)
├── src/
│   ├── proto/
│   │   ├── hardware.proto           # Contrato gRPC del Catálogo (Go :50051)
│   │   └── simulator.proto          # Contrato gRPC del Simulador (Java :9090)
│   └── index.ts                     # Servidor Express, clientes gRPC, 7 tools y bucle Gemini
├── tests/
│   └── index.test.ts                # Suite de tests (Vitest + Supertest)
├── .dockerignore
├── .env                             # Variables de entorno locales (ignorado en Git)
├── .env.example                     # Plantilla de variables de entorno
├── .gitignore                       # Archivos ignorados por Git (incluye coverage/ y .env)
├── Dockerfile                       # Imagen multi-stage Node 20 Alpine
├── package.json                     # Dependencias y scripts
├── tsconfig.json                    # Configuración de TypeScript (ESM)
└── README.md
```

---

## 8. Checklist de Avance

* [x] Inicializar servidor Express con TypeScript (ESM) y Google Generative AI SDK.
* [x] Conectar clientes gRPC hacia Catálogo (`:50051`) y Simulador (`:9090`) + clientes REST (`:8081`).
* [x] Implementar bucle agéntico con 7 herramientas reales y aislamiento de usuario por `x-user-id`.
* [x] Externalizar `GEMINI_API_KEY` y `GEMINI_MODEL` mediante `.env` y `.env.example`.
* [x] Implementar tests unitarios y de integración (Vitest + Supertest) superando el 60% de cobertura (92.72% statements / 94.11% líneas).
* [x] Crear `Dockerfile` (multi-stage con copia de `.proto`) y `.dockerignore`.
* [x] Configurar pipeline CI/CD (GitHub Actions).