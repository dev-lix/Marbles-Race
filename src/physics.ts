import RAPIER from "@dimforge/rapier3d-compat";

export async function createPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}

export { RAPIER };
