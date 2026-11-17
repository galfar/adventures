import type { Page, Story } from './format/types.ts';

/**
 * The editor's projects, kept in the browser's IndexedDB. The player reads from here
 * too, to play-test a project straight from the editor.
 *
 * Three stores:
 *  - `projects`:  one record per adventure (the story, its trash, the undo history)
 *  - `assets`:    picture files, keyed by project and path (`images/abc.jpg`)
 *  - `snapshots`: automatic older versions of a project, for "go back to yesterday"
 */

/** What the editor edits and undoes as one unit. Only `story` is exported. */
export interface EditorDoc {
  story: Story;
  /** Deleted pages, newest first. They can be put back. */
  trash: TrashedPage[];
}

export interface TrashedPage {
  page: Page;
  deletedAt: number;
}

export interface ProjectRecord {
  id: string;
  doc: EditorDoc;
  /** Undo and redo history, saved with the project so it survives a reload. */
  past: EditorDoc[];
  future: EditorDoc[];
  createdAt: number;
  updatedAt: number;
  /** Set when the project is in the "deleted adventures" list. */
  deletedAt?: number;
}

export interface SnapshotRecord {
  key?: number;
  projectId: string;
  time: number;
  doc: EditorDoc;
}

export interface AssetRecord {
  projectId: string;
  path: string;
  blob: Blob;
}

const SNAPSHOTS_KEPT = 20;

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('adventures-editor', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('assets', { keyPath: ['projectId', 'path'] });
      db.createObjectStore('snapshots', { keyPath: 'key', autoIncrement: true }).createIndex('projectId', 'projectId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** Runs one transaction; resolves with the result of the request `work` returns (if any). */
async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve((request ? request.result : undefined) as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** All assets of one project: keys from [id] up to [id, anything]. */
const assetsOf = (projectId: string) => IDBKeyRange.bound([projectId], [projectId, []]);

export function listProjects(): Promise<ProjectRecord[]> {
  return run(['projects'], 'readonly', (tx) => tx.objectStore('projects').getAll() as IDBRequest<ProjectRecord[]>);
}

export function getProject(id: string): Promise<ProjectRecord | undefined> {
  return run(['projects'], 'readonly', (tx) => tx.objectStore('projects').get(id) as IDBRequest<ProjectRecord | undefined>);
}

export function saveProject(record: ProjectRecord): Promise<void> {
  return run(['projects'], 'readwrite', (tx) => {
    tx.objectStore('projects').put(record);
  });
}

/** Deletes a project for good, with its pictures and snapshots. This cannot be undone. */
export function removeProject(id: string): Promise<void> {
  return run(['projects', 'assets', 'snapshots'], 'readwrite', (tx) => {
    tx.objectStore('projects').delete(id);
    tx.objectStore('assets').delete(assetsOf(id));
    const cursor = tx.objectStore('snapshots').index('projectId').openKeyCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      tx.objectStore('snapshots').delete(cursor.result.primaryKey);
      cursor.result.continue();
    };
  });
}

export function saveAsset(projectId: string, path: string, blob: Blob): Promise<void> {
  return run(['assets'], 'readwrite', (tx) => {
    tx.objectStore('assets').put({ projectId, path, blob } satisfies AssetRecord);
  });
}

export function listAssets(projectId: string): Promise<AssetRecord[]> {
  return run(['assets'], 'readonly', (tx) => tx.objectStore('assets').getAll(assetsOf(projectId)) as IDBRequest<AssetRecord[]>);
}

export function removeAsset(projectId: string, path: string): Promise<void> {
  return run(['assets'], 'readwrite', (tx) => {
    tx.objectStore('assets').delete([projectId, path]);
  });
}

export function listSnapshots(projectId: string): Promise<SnapshotRecord[]> {
  return run(
    ['snapshots'],
    'readonly',
    (tx) => tx.objectStore('snapshots').index('projectId').getAll(IDBKeyRange.only(projectId)) as IDBRequest<SnapshotRecord[]>,
  );
}

/** Stores a version of the project and forgets the oldest ones beyond the limit. */
export async function addSnapshot(projectId: string, doc: EditorDoc): Promise<void> {
  await run(['snapshots'], 'readwrite', (tx) => {
    tx.objectStore('snapshots').add({ projectId, time: Date.now(), doc } satisfies SnapshotRecord);
  });
  const all = await listSnapshots(projectId);
  const extra = all.slice(0, Math.max(0, all.length - SNAPSHOTS_KEPT));
  if (extra.length === 0) return;
  await run(['snapshots'], 'readwrite', (tx) => {
    for (const old of extra) tx.objectStore('snapshots').delete(old.key!);
  });
}
