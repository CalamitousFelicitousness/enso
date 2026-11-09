// The entry: a reset asked for on the last page is carried out before the app
// and its stores load.

import { bootProfile } from "./profile/boot";

void bootProfile().then(() => import("./start"));
