import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
    app,
    extraerBenchmarkScore,
    ejecutarTool,
    simulatorClient,
    catalogoClient,
    model
} from '../src/index.js';

describe('extraerBenchmarkScore', () => {
    it('retorna 10000 si no recibe JSON o es inválido', () => {
        expect(extraerBenchmarkScore(undefined)).toBe(10000);
        expect(extraerBenchmarkScore('no-es-json')).toBe(10000);
        expect(extraerBenchmarkScore('{}')).toBe(10000);
    });

    it('extrae claves prioritarias o el primer número positivo', () => {
        expect(extraerBenchmarkScore(JSON.stringify({ passmark: 28500.4 }))).toBe(28500);
        expect(extraerBenchmarkScore(JSON.stringify({ custom_metric: 15400 }))).toBe(15400);
    });
});

describe('ejecutarTool', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('listar_componentes filtra por texto de búsqueda', async () => {
        vi.spyOn(catalogoClient, 'ListarComponentes').mockImplementation((_req: any, cb: any) => {
            cb(null, {
                componentes: [
                    { id: '1', nombre: 'Ryzen 5 9600X', fabricante: 'AMD', socket: 'AM5' },
                    { id: '2', nombre: 'Core i5-14600K', fabricante: 'Intel', socket: 'LGA1700' }
                ]
            });
        });

        const res = await ejecutarTool('listar_componentes', { tipo: 'cpu', busqueda: 'ryzen' }, '3');
        expect(res.total).toBe(1);
        expect(res.componentes[0].nombre).toBe('Ryzen 5 9600X');
    });

    it('obtener_specs_componente y verificar_compatibilidad llaman al catálogo gRPC', async () => {
        vi.spyOn(catalogoClient, 'ObtenerSpecs').mockImplementation((_req: any, cb: any) => {
            cb(null, { id: 'cpu-1', nombre: 'Ryzen 5 9600X', tdp: 65 });
        });
        vi.spyOn(catalogoClient, 'VerificarCompatibilidad').mockImplementation((_req: any, cb: any) => {
            cb(null, { compatible: true, errores: [] });
        });

        const specs = await ejecutarTool('obtener_specs_componente', { id: 'cpu-1' }, '3');
        expect(specs.nombre).toBe('Ryzen 5 9600X');

        const compat = await ejecutarTool('verificar_compatibilidad', {
            cpu_id: 'cpu-1', motherboard_id: 'mb-1', ram_id: 'ram-1', psu_id: 'psu-1'
        }, '3');
        expect(compat.compatible).toBe(true);
    });

    it('simular_build_por_ids y simular_rendimiento_manual llaman al simulador gRPC', async () => {
        vi.spyOn(catalogoClient, 'ObtenerSpecs').mockImplementation((req: any, cb: any) => {
            if (req.id === 'cpu-1') cb(null, { nombre: 'Ryzen 5', tdp: 65, benchmarks_json: '{"passmark":30000}' });
            else if (req.id === 'gpu-1') cb(null, { nombre: 'RTX 5060 Ti', tdp: 180, benchmarks_json: '{"score":30000}' });
            else cb(null, { nombre: '750W', potencia_w: 750 });
        });
        vi.spyOn(simulatorClient, 'SimularRendimiento').mockImplementation((_req: any, cb: any) => {
            cb(null, { consumo_total_watts: 295, estado: 'Óptimo' });
        });

        const resIds = await ejecutarTool('simular_build_por_ids', {
            cpu_id: 'cpu-1', gpu_id: 'gpu-1', psu_id: 'psu-1', resolucion: '1440p'
        }, '3');
        expect(resIds.simulacion.estado).toBe('Óptimo');

        const resManual = await ejecutarTool('simular_rendimiento_manual', {
            cpu_tdp_watts: 65, cpu_benchmark_score: 30000, gpu_tdp_watts: 180,
            gpu_benchmark_score: 30000, psu_watts: 750, resolucion: '1080p'
        }, '3');
        expect(resManual.consumo_total_watts).toBe(295);
    });

    it('listar_mis_builds y guardar_build consultan el Simulador REST', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 1, nombreBuild: 'PC 1' }] } as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 2, success: true }) } as any);

        const lista = await ejecutarTool('listar_mis_builds', {}, '3');
        expect(lista.total).toBe(1);

        const guardada = await ejecutarTool('guardar_build', { nombreBuild: 'PC 2' }, '3');
        expect(guardada.id).toBe(2);
    });

    it('maneja herramienta desconocida y errores de gRPC/HTTP sin caer', async () => {
        const desc = await ejecutarTool('tool_inexistente', {}, '3');
        expect(desc.error).toContain('Herramienta desconocida');

        vi.spyOn(catalogoClient, 'ObtenerSpecs').mockImplementation((_req: any, cb: any) => {
            cb(new Error('gRPC caído'));
        });
        const errRes = await ejecutarTool('obtener_specs_componente', { id: 'x' }, '3');
        expect(errRes.error).toContain('gRPC caído');
    });
});

describe('POST /chat', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('retorna 400 si falta prompt y 401 si falta x-user-id', async () => {
        const res400 = await request(app).post('/chat').set('x-user-id', '3').send({});
        expect(res400.status).toBe(400);

        const res401 = await request(app).post('/chat').send({ prompt: 'Hola' });
        expect(res401.status).toBe(401);
    });

    it('retorna 200 ejecutando el bucle agéntico con una tool', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => [{ id: 1, nombreBuild: 'PC Gamer' }]
        } as any);

        const sendMessage = vi.fn()
            .mockResolvedValueOnce({
                response: {
                    functionCalls: () => [{ name: 'listar_mis_builds', args: {} }],
                    text: () => ''
                }
            })
            .mockResolvedValueOnce({
                response: {
                    functionCalls: () => [],
                    text: () => 'Tienes 1 build guardada: PC Gamer.'
                }
            });

        vi.spyOn(model, 'startChat').mockReturnValue({ sendMessage } as any);

        const res = await request(app)
            .post('/chat')
            .set('x-user-id', '3')
            .send({ prompt: '¿Qué builds tengo?' });

        expect(res.status).toBe(200);
        expect(res.body.respuesta).toContain('PC Gamer');
    });

    it('retorna 500 si ocurre un error inesperado en Gemini', async () => {
        vi.spyOn(model, 'startChat').mockImplementation(() => {
            throw new Error('Fallo de red');
        });

        const res = await request(app)
            .post('/chat')
            .set('x-user-id', '3')
            .send({ prompt: 'Hola' });

        expect(res.status).toBe(500);
    });
});