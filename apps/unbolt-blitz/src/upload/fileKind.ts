/** Extensions the app accepts for a Custom_Upload. */
export const ACCEPTED_EXTENSIONS = [".glb", ".gltf"] as const;

export type FileKind = "glb" | "gltf" | "unsupported";

/** Classifies a file name by its extension, case-insensitively. */
export function classifyFile(fileName: string): FileKind {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "unsupported";
  const extension = fileName.slice(dot).toLowerCase();
  if (extension === ".glb") return "glb";
  if (extension === ".gltf") return "gltf";
  return "unsupported";
}
