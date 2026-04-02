/// <reference types="vitest" />

import { defineConfig } from "vite";
import {
  vitestSetupFilePath,
  getClarinetVitestsArgv,
} from "@hirosystems/clarinet-sdk/vitest";

export default defineConfig({
  test: {
    environment: "clarinet", // usa vitest-environment-clarinet para simnet embebido
    pool: "forks",
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
    setupFiles: [
      vitestSetupFilePath,
      // aquí podrías añadir otros setup files si quieres
    ],
    environmentOptions: {
      clarinet: {
        ...getClarinetVitestsArgv(),
        // aquí podrías sobreescribir config de clarinet si lo necesitas
      },
    },
  },
});
