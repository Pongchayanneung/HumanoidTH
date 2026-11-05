import "server-only";
import { runtimeOperatorAuth } from "./runtime";

export const loginOperator = runtimeOperatorAuth.loginOperator;
export const readOperatorSession = runtimeOperatorAuth.readOperatorSession;
export const revokeOperatorSession = runtimeOperatorAuth.revokeOperatorSession;
