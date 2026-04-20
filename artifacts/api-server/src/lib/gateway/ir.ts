import type {
  GatewayIRSummary,
  GatewayMessage,
  GatewayPart,
  GatewayRequestIR,
  GatewayRole,
} from "./types";

function uniqueRoles(messages: GatewayMessage[]): GatewayRole[] {
  const roles = new Set<GatewayRole>();
  for (const message of messages) roles.add(message.role);
  return Array.from(roles);
}

function uniquePartTypes(messages: GatewayMessage[]): GatewayPart["type"][] {
  const partTypes = new Set<GatewayPart["type"]>();
  for (const message of messages) {
    for (const part of message.parts) partTypes.add(part.type);
  }
  return Array.from(partTypes);
}

export function summarizeIR(ir: GatewayRequestIR): GatewayIRSummary {
  return {
    requestedModel: ir.requestedModel,
    logicalModel: ir.modelResolution?.logical,
    resolvedModel: ir.model,
    model: ir.model,
    stream: ir.stream,
    messageCount: ir.messages.length,
    toolCount: ir.tools.length,
    roles: uniqueRoles(ir.messages),
    partTypes: uniquePartTypes(ir.messages),
    responseFormatType: ir.responseFormat?.type,
    reasoning: ir.reasoning,
    verbosity: ir.verbosity,
    provider: ir.provider,
    providerRoute: ir.modelResolution?.providerRoute,
    cache: ir.cache,
    metadata: ir.metadata,
  };
}