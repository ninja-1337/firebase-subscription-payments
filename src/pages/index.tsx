import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type CollectionReference,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { auth, db, storage } from '@/lib/firebase';

type DeploymentStep = {
  name: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
};

type DeploymentVersion = {
  id: string;
  versionNumber: number;
  versionTag: string;
  fileName: string;
  fileSize: number;
  releaseNotes?: string;
  downloadUrl?: string;
  status: string;
  createdAt?: Timestamp;
  steps: DeploymentStep[];
};

const defaultSteps: DeploymentStep[] = [
  { name: 'Upload ZIP', status: 'complete' },
  { name: 'Unzip & version in Git', status: 'queued' },
  { name: 'Re-zip & deploy to Firebase', status: 'queued' },
];

const pipelineCards = [
  {
    title: 'Upload ZIP',
    description: 'Store the raw archive securely in Firebase Storage.',
  },
  {
    title: 'Unzip & version',
    description: 'Extract files, commit to Git, and tag a release.',
  },
  {
    title: 'Re-zip & deploy',
    description: 'Repackage the versioned site and deploy to Hosting.',
  },
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [versions, setVersions] = useState<DeploymentVersion[]>([]);
  const [status, setStatus] = useState('Waiting for ZIP upload.');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const isFirebaseConfigured = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    []
  );

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setStatus('Firebase configuration missing. Add NEXT_PUBLIC_FIREBASE_* vars.');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser) {
        setUser(nextUser);
      } else {
        signInAnonymously(auth).catch(() => {
          setStatus('Unable to sign in. Check Firebase Auth settings.');
        });
      }
    });

    return () => unsubscribe();
  }, [isFirebaseConfigured]);

  useEffect(() => {
    if (!user) {
      setVersions([]);
      return;
    }

    const versionsRef = collection(db, 'cicdDeployments', user.uid, 'versions');
    const versionsQuery = query(versionsRef, orderBy('versionNumber', 'desc'));
    const unsubscribe = onSnapshot(versionsQuery, (snapshot) => {
      const nextVersions: DeploymentVersion[] = snapshot.docs.map((doc) => {
        const data = doc.data() as Omit<DeploymentVersion, 'id'>;
        return {
          ...data,
          id: doc.id,
          steps: data.steps ?? [],
        };
      });
      setVersions(nextVersions);
    });

    return () => unsubscribe();
  }, [user]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setSelectedFile(file);
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!user) {
        setStatus('Sign in before deploying.');
        return;
      }

      if (!selectedFile) {
        setStatus('Select a ZIP file to deploy.');
        return;
      }

      const isZip =
        selectedFile.type.includes('zip') ||
        selectedFile.name.toLowerCase().endsWith('.zip');
      if (!isZip) {
        setStatus('Only ZIP files are supported.');
        return;
      }

      setIsUploading(true);
      setStatus('Uploading ZIP to Firebase Storage...');

      const versionsRef = collection(db, 'cicdDeployments', user.uid, 'versions');
      const nextVersion = await getNextVersionNumber(versionsRef);
      const versionTag = `v${nextVersion}`;
      const storageRef = ref(
        storage,
        `deployments/${user.uid}/${versionTag}/${selectedFile.name}`
      );

      await uploadBytes(storageRef, selectedFile);
      const downloadUrl = await getDownloadURL(storageRef);

      await addDoc(versionsRef, {
        versionNumber: nextVersion,
        versionTag,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        releaseNotes: notes.trim(),
        downloadUrl,
        status: 'queued',
        steps: defaultSteps,
        createdAt: serverTimestamp(),
      });

      setStatus('Deployment queued. CI can now version and deploy.');
      setNotes('');
      setSelectedFile(null);
      setIsUploading(false);
    },
    [notes, selectedFile, user]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand text-white">
        <div className="mx-auto flex w-11/12 max-w-5xl items-center justify-between py-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em]">
              CICD pipeline
            </p>
            <h1 className="text-2xl font-bold sm:text-3xl">
              Deploy ZIP-based websites to Firebase
            </h1>
          </div>
          <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
            T3 frontend
          </span>
        </div>
      </header>

      <main>
        <section className="rounded-3xl bg-white p-8 shadow-lg">
          <h2 className="text-xl font-semibold text-slate-900">
            Website deployment pipeline
          </h2>
          <p className="mt-2 text-slate-600">
            Upload a website ZIP, version the contents with Git, and push a
            release to Firebase Hosting. Each upload stores an artifact, commits
            a release, and queues your deployment workflow.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6"
          >
            <label className="text-sm font-semibold text-slate-700">
              Website ZIP file
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Release notes
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Describe what changed in this release."
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={isUploading}
              className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading…' : 'Deploy to Firebase'}
            </button>
            <p className="text-sm font-semibold text-slate-600">{status}</p>
          </form>
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-3">
          {pipelineCards.map((card, index) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white">
                {index + 1}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                {card.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600">{card.description}</p>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-slate-900">
              Release history
            </h3>
            {user ? (
              <span className="text-sm text-slate-500">
                Tracking deployments for {user.uid}
              </span>
            ) : null}
          </div>
          <div className="mt-6 grid gap-6">
            {versions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                No releases yet. Upload a ZIP to create your first deployment.
              </div>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900">
                        {version.versionTag} · {version.status}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {[
                          version.fileName,
                          formatBytes(version.fileSize),
                          formatTimestamp(version.createdAt),
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      </p>
                    </div>
                    {version.downloadUrl ? (
                      <a
                        href={version.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-brand hover:text-brand-dark"
                      >
                        Download ZIP
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-4 text-sm text-slate-600">
                    {version.releaseNotes || 'No release notes provided.'}
                  </p>
                  <ul className="mt-4 grid gap-2 text-sm text-slate-500">
                    {version.steps.map((step) => (
                      <li
                        key={step.name}
                        className="rounded-xl bg-slate-50 px-3 py-2"
                      >
                        {step.name}: {step.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

async function getNextVersionNumber(
  versionsRef: CollectionReference<DocumentData>
) {
  const latestQuery = query(versionsRef, orderBy('versionNumber', 'desc'), limit(1));
  const snapshot = await getDocs(latestQuery);
  if (snapshot.empty) {
    return 1;
  }
  const lastVersion = snapshot.docs[0]?.data().versionNumber ?? 0;
  return Number(lastVersion) + 1;
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

function formatTimestamp(timestamp?: Timestamp) {
  if (!timestamp) return '';
  return timestamp.toDate().toLocaleString();
}
