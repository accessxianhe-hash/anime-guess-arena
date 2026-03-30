import { randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64url");
console.log(secret);
