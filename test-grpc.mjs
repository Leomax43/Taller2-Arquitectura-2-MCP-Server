import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve('./src/proto/simulator.proto'); // o './proto/simulator.proto'
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef);
const client = new proto.simulator.SimulatorService(
  'localhost:9090',
  grpc.credentials.createInsecure()
);

const callGrpc = (method, payload) =>
  new Promise((resolve, reject) => {
    client[method](payload, (err, res) => (err ? reject(err) : resolve(res)));
  });

async function run() {
  console.log('1) Probando GuardarBuild...');
  const saved = await callGrpc('GuardarBuild', {
    user_id: '123',
    nombre_build: 'Build Prueba gRPC',
    cpu_id: 'cpu-9600x',
    gpu_id: 'gpu-5060ti',
    motherboard_id: 'mb-b650',
    ram_id: 'ram-ddr5-32',
    psu_id: 'psu-650',
    resolucion: '1080p',
    consumo_total_watts: 295,
    cpu_nombre: 'Ryzen 5 9600X',
    gpu_nombre: 'RTX 5060 Ti',
    cuello_botella_porcentaje: 5,
    estado_riesgo: 'Óptimo',
  });
  console.log('✅ Guardada:', saved);

  console.log('\n2) Probando ListarBuilds...');
  const list = await callGrpc('ListarBuilds', { user_id: '123' });
  console.log(`✅ Total builds del usuario 123: ${list.builds.length}`);
  console.log('Última build:', list.builds[list.builds.length - 1]);

  console.log('\n3) Probando EliminarBuild...');
  const deleted = await callGrpc('EliminarBuild', {
    build_id: saved.build_id,
    user_id: '123',
  });
  console.log('✅ Eliminada:', deleted);
}

run().catch((err) => console.error('❌ Error gRPC:', err));