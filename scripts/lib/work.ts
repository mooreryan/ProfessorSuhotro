/* These are used in the browser and in node. */

import * as Zod from "zod";

export const WorkSchema = Zod.enum([
  "Applied Python Programming",
  "The Python Tutorial",
]);

export type Work = Zod.infer<typeof WorkSchema>;
