/** File System Access API (Chrome). Only the dev-only frame baker uses it. */
interface Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
}
