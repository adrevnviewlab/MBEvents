import type { IncomingMessage, ServerResponse } from "node:http";
import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttpImport from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

type HttpLoggerFactory = (opts: {
  logger: typeof logger;
  serializers: {
    req: (req: IncomingMessage & { id?: unknown }) => {
      id: unknown;
      method?: string;
      url?: string;
    };
    res: (res: ServerResponse) => { statusCode: number };
  };
}) => RequestHandler;

function resolvePinoHttp(mod: unknown): HttpLoggerFactory {
  const candidate =
    typeof mod === "function"
      ? mod
      : mod && typeof mod === "object" && "default" in mod
        ? (mod as { default: unknown }).default
        : undefined;
  if (typeof candidate !== "function") {
    throw new Error("pino-http export is not a function");
  }
  return candidate as HttpLoggerFactory;
}

const pinoHttp = resolvePinoHttp(pinoHttpImport);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
