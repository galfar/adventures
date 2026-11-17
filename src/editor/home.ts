import { listAssets, listProjects, removeProject, saveAsset, saveProject, type ProjectRecord } from '../shared/db.ts';
import { confirmDialog, h } from '../shared/dom.ts';
import type { Story } from '../shared/format/types.ts';
import { normalizeStory } from '../shared/format/validate.ts';
import { importZip } from './export.ts';
import { setEditorLanguage, type Translate } from './i18n/index.ts';
import { assetRefs, copyStory, ensurePositions, newId, newStory } from './ops.ts';

/** The home screen: the list of the author's adventures. */

interface SampleEntry {
  path: string;
  title: string;
}

function newRecord(story: Story): ProjectRecord {
  const now = Date.now();
  return { id: newId('project') + now.toString(36), doc: { story, trash: [] }, past: [], future: [], createdAt: now, updatedAt: now };
}

const openProject = (id: string) => location.assign(`#/p/${encodeURIComponent(id)}`);

/** Copies one of the bundled example adventures, with its pictures, into a new project. */
async function importSample(entry: SampleEntry): Promise<string> {
  const base = new URL(entry.path.replace(/\/?$/, '/'), location.href);
  const response = await fetch(new URL('story.json', base));
  if (!response.ok) throw new Error(String(response.status));
  const story = copyStory(normalizeStory(await response.json()), entry.title);
  ensurePositions(story);
  const record = newRecord(story);
  for (const ref of assetRefs(story)) {
    const picture = await fetch(new URL(ref, base));
    if (picture.ok) await saveAsset(record.id, ref, await picture.blob());
  }
  await saveProject(record);
  return record.id;
}

export async function showHome(root: HTMLElement, t: Translate, language: string, refresh: () => void): Promise<void> {
  const projects = (await listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  const active = projects.filter((project) => project.deletedAt === undefined);
  const deleted = projects.filter((project) => project.deletedAt !== undefined);
  let samples: SampleEntry[] = [];
  try {
    const response = await fetch('adventures/index.json');
    if (response.ok) samples = (await response.json()) as SampleEntry[];
  } catch {
    // No examples available.
  }

  const titleOf = (project: ProjectRecord) => project.doc.story.title || t('untitled');
  const when = (time: number) => new Date(time).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  const update = async (project: ProjectRecord, changes: Partial<ProjectRecord>) => {
    await saveProject({ ...project, ...changes });
    refresh();
  };
  const error = h('p', { class: 'field-error', role: 'alert' });
  const fileInput = h('input', {
    class: 'file-input',
    type: 'file',
    accept: '.zip,application/zip',
    tabindex: -1,
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        openProject(await importZip(await file.arrayBuffer()));
      } catch {
        error.textContent = t('importFailed');
      }
    },
  });

  const card = (project: ProjectRecord) =>
    h(
      'li',
      { class: 'project' },
      h(
        'a',
        { class: 'project-main', href: `#/p/${encodeURIComponent(project.id)}` },
        h('strong', null, titleOf(project)),
        h('small', null, `${t('pagesCount', { n: project.doc.story.pages.length })} · ${t('changed', { when: when(project.updatedAt) })}`),
      ),
      h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            class: 'action',
            onclick: async () => {
              const copy = newRecord(copyStory(project.doc.story, t('copyOf', { title: titleOf(project) })));
              copy.doc.trash = structuredClone(project.doc.trash);
              for (const asset of await listAssets(project.id)) await saveAsset(copy.id, asset.path, asset.blob);
              await saveProject(copy);
              refresh();
            },
          },
          t('duplicate'),
        ),
        // Deleting only moves the adventure to the list below; it can be put back.
        h('button', { class: 'action', onclick: () => void update(project, { deletedAt: Date.now() }) }, `🗑 ${t('deleteProject')}`),
      ),
    );

  const deletedCard = (project: ProjectRecord) =>
    h(
      'li',
      { class: 'project' },
      h('div', { class: 'project-main' }, h('strong', null, titleOf(project)), h('small', null, t('deletedWhen', { when: when(project.deletedAt!) }))),
      h(
        'div',
        { class: 'button-row' },
        h('button', { class: 'action', onclick: () => void update(project, { deletedAt: undefined }) }, t('putBack')),
        h(
          'button',
          {
            class: 'action danger',
            onclick: async () => {
              if (!(await confirmDialog(t('deleteForeverConfirm', { title: titleOf(project) }), t('deleteForever'), t('no')))) return;
              await removeProject(project.id);
              refresh();
            },
          },
          t('deleteForever'),
        ),
      ),
    );

  root.replaceChildren(
    h(
      'main',
      { class: 'home' },
      h(
        'div',
        { class: 'home-head' },
        h('h1', null, `📖 ${t('appTitle')}`),
        h(
          'div',
          { class: 'button-row' },
          h('a', { class: 'action', href: 'index.html' }, `▶ ${t('toPlayer')}`),
          h(
            'button',
            {
              class: 'action',
              onclick: () => {
                setEditorLanguage(language === 'cs' ? 'en' : 'cs');
                refresh();
              },
            },
            `🌐 ${t('switchLanguage')}`,
          ),
        ),
      ),
      h('p', { class: 'field-note' }, active.length === 0 ? t('noProjects') : t('homeIntro')),
      h(
        'button',
        {
          class: 'action primary big',
          onclick: async () => {
            const record = newRecord(newStory(t('newProjectTitle'), language));
            await saveProject(record);
            openProject(record.id);
          },
        },
        `＋ ${t('newProject')}`,
      ),
      ' ',
      h('button', { class: 'action big', onclick: () => fileInput.click() }, `📦 ${t('importZip')}`),
      fileInput,
      h('ul', { class: 'projects' }, active.map(card)),
      samples.length > 0 && h('h2', null, t('samples')),
      h(
        'div',
        { class: 'button-row' },
        samples.map((sample) =>
          h(
            'button',
            {
              class: 'action',
              onclick: async () => {
                try {
                  openProject(await importSample(sample));
                } catch {
                  error.textContent = t('sampleFailed');
                }
              },
            },
            sample.title,
          ),
        ),
      ),
      error,
      deleted.length > 0 && h('h2', null, t('deletedProjects')),
      h('ul', { class: 'projects' }, deleted.map(deletedCard)),
    ),
  );
}
