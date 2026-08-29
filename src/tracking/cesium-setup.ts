// cesium-setup enforces the ion-free self-hosted Cesium posture (decision
// D5) before any Viewer is constructed: the ion access token is emptied so
// no code path can authenticate against cesium.com, and the base layer,
// terrain and assets all come from the portal's own deployment (runtime
// config tile_url + the /cesium static assets copied at build time).
import { Ion } from "cesium";

Ion.defaultAccessToken = "";

export {};
