interface AuditEntry {
  ts: string;
  tool: string;
  operation_id?: string;
  status: "ok" | "error";
  error_code?: string;
}

export function audit(entry: Omit<AuditEntry, "ts">): void {
  if (process.env.LINE_MOVER_AUDIT_SILENT === "1") return;
  const line: AuditEntry = { ts: new Date().toISOString(), ...entry };
  process.stderr.write(JSON.stringify(line) + "\n");
}
