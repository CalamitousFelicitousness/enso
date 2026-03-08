export interface BackendConnection {
  id: string;
  name: string;
  url: string;
  auth?: { username: string; password: string };
  lastConnected?: number;
}

const STORAGE_KEY = "enso-connections";

export function loadConnections(): BackendConnection[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveConnections(connections: BackendConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
}

export function getActiveConnectionId(): string | null {
  return localStorage.getItem("enso-active-connection");
}

export function setActiveConnectionId(id: string | null): void {
  if (id) {
    localStorage.setItem("enso-active-connection", id);
  } else {
    localStorage.removeItem("enso-active-connection");
  }
}
