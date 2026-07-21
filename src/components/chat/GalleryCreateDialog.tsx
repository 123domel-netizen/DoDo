import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatFileSize } from "@/lib/chat/upload";
import {
  createGallery,
  galleryFileDims,
  listStorageOrgsForConversation,
  MAX_GALLERY_ITEMS_PER_CALL,
  prepareGalleryImages,
  uploadGalleryItem,
  type StorageOrgOption,
} from "@/lib/chat/galleryApi";

interface GalleryCreateDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onCreated?: (galleryId: string, messageId: string | null) => void;
}

type Step = "form" | "uploading" | "done";

interface UploadItem {
  id: string;
  file: File;
  status: "pending" | "uploading" | "ready" | "failed";
  errorMessage?: string | null;
}

/** Kreator galerii — zdjęcia trafiają do magazynu zespołu (SharePoint), a w czacie ląduje karta. */
export function GalleryCreateDialog({
  open,
  onClose,
  conversationId,
  onCreated,
}: GalleryCreateDialogProps) {
  const [step, setStep] = useState<Step>("form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [orgs, setOrgs] = useState<StorageOrgOption[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setTitle("");
    setDescription("");
    setFiles([]);
    setPreviews([]);
    setError(null);
    setGalleryId(null);
    setMessageId(null);
    setItems([]);
    setSubmitting(false);
    setOrgs(null);
    setOrgId(null);
    void listStorageOrgsForConversation(conversationId).then((res) => {
      if (!mountedRef.current) return;
      const list = res.data?.orgs ?? [];
      setOrgs(list);
      if (list.length === 1) setOrgId(list[0]!.orgId);
    });
  }, [open, conversationId]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  if (!open) return null;

  const orgsWithStorage = orgs ?? [];
  const noStorageAvailable = orgs !== null && orgsWithStorage.length === 0;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).filter((f) => /^image\//i.test(f.type));
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_GALLERY_ITEMS_PER_CALL));
  };

  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  };

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async () => {
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Podaj nazwę galerii.");
      return;
    }
    if (files.length === 0) {
      setError("Dodaj przynajmniej jedno zdjęcie.");
      return;
    }
    if (!orgId) {
      setError("Wybierz zespół, w którym zapisać galerię.");
      return;
    }

    setSubmitting(true);
    try {
      const prepared = await prepareGalleryImages(files);
      const res = await createGallery({
        conversationId,
        orgId,
        title: cleanTitle,
        description: description.trim() || undefined,
        items: prepared.map((f) => ({
          fileName: f.name,
          mimeType: f.type || "image/jpeg",
          sizeBytes: f.size,
          ...galleryFileDims(f),
        })),
      });
      if (!mountedRef.current) return;
      if (res.error || !res.data) {
        setError(res.error || "Nie udało się utworzyć galerii.");
        setSubmitting(false);
        return;
      }

      const { gallery, items: galleryItems, messageId: newMessageId } = res.data;
      const nextItems: UploadItem[] = prepared.map((f, i) => ({
        id: galleryItems[i]?.id ?? `${gallery.id}-${i}`,
        file: f,
        status: "pending",
      }));
      setGalleryId(gallery.id);
      setMessageId(newMessageId ?? null);
      setItems(nextItems);
      setStep("uploading");
      setSubmitting(false);
      void runUploads(gallery.id, nextItems);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Nie udało się utworzyć galerii.");
      setSubmitting(false);
    }
  };

  const runUploads = async (gId: string, list: UploadItem[]) => {
    for (const it of list) {
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(gId, it);
    }
    if (mountedRef.current) setStep("done");
  };

  const uploadOne = async (gId: string, it: UploadItem) => {
    if (mountedRef.current) {
      setItems((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, status: "uploading", errorMessage: null } : x)),
      );
    }
    const res = await uploadGalleryItem(gId, it.id, it.file);
    if (!mountedRef.current) return;
    setItems((prev) =>
      prev.map((x) =>
        x.id === it.id
          ? { ...x, status: res.error ? "failed" : "ready", errorMessage: res.error ?? null }
          : x,
      ),
    );
  };

  const retryItem = (it: UploadItem) => {
    if (!galleryId) return;
    void uploadOne(galleryId, it);
  };

  const finish = () => {
    if (galleryId) onCreated?.(galleryId, messageId);
    onClose();
  };

  const uploadedCount = items.filter((i) => i.status === "ready").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const allDone = items.length > 0 && uploadedCount + failedCount === items.length;

  return (
    <Modal open={open} onClose={close} width={480}>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <ImagePlus size={16} className="text-accent" /> Nowa galeria
        </div>

        {step === "form" && (
          <>
            <div className="space-y-2.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nazwa galerii (np. Wesele — 12.07)"
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Opis (opcjonalnie)"
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
              />

              {orgs === null && (
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                  <Loader2 size={13} className="animate-spin" /> Sprawdzanie magazynu zespołu…
                </div>
              )}

              {noStorageAvailable && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Żaden zespół w tej rozmowie nie ma podłączonego magazynu plików. Poproś
                    administratora zespołu, aby skonfigurował go w Ustawieniach → Zespół →
                    Magazyn plików.
                  </span>
                </div>
              )}

              {orgsWithStorage.length > 1 && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                    Zespół (magazyn plików)
                  </span>
                  <select
                    value={orgId ?? ""}
                    onChange={(e) => setOrgId(e.target.value || null)}
                    className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent/50"
                  >
                    <option value="" disabled>
                      Wybierz zespół…
                    </option>
                    {orgsWithStorage.map((o) => (
                      <option key={o.orgId} value={o.orgId}>
                        {o.orgName}
                        {o.baseFolderName ? ` — ${o.baseFolderName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-ink-light transition hover:border-accent/50 hover:text-ink"
                >
                  <ImagePlus size={15} /> Dodaj zdjęcia
                </button>
              </div>

              {files.length > 0 && (
                <div className="thin-scrollbar grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto">
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-raised"
                    >
                      <img
                        src={previews[i]}
                        alt={f.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        aria-label={`Usuń ${f.name}`}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {files.length > 0 && (
                <div className="text-[11px] text-ink-faint">
                  {files.length} {files.length === 1 ? "zdjęcie" : "zdjęć"}
                </div>
              )}
            </div>

            {error && <div className="mt-2.5 text-xs text-red-400">{error}</div>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:border-line-strong hover:text-ink"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || noStorageAvailable || orgs === null}
                className="flex items-center gap-1.5 rounded-lg bg-accent-grad px-4 py-1.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Utwórz galerię
              </button>
            </div>
          </>
        )}

        {(step === "uploading" || step === "done") && (
          <>
            <div className="mb-2 text-xs text-ink-light">
              {allDone
                ? failedCount > 0
                  ? `Przesłano ${uploadedCount}/${items.length} — ${failedCount} nieudanych.`
                  : `Przesłano ${uploadedCount}/${items.length} zdjęć.`
                : `Przesyłanie ${uploadedCount + failedCount + 1}/${items.length}…`}
            </div>
            <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full bg-accent-grad transition-all"
                style={{
                  width: `${items.length ? ((uploadedCount + failedCount) / items.length) * 100 : 0}%`,
                }}
              />
            </div>

            <div className="thin-scrollbar mt-3 max-h-64 space-y-1.5 overflow-y-auto">
              {items.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{it.file.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {formatFileSize(it.file.size)}
                  </span>
                  {it.status === "uploading" && (
                    <Loader2 size={13} className="shrink-0 animate-spin text-ink-faint" />
                  )}
                  {it.status === "pending" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint/40" />
                  )}
                  {it.status === "ready" && (
                    <Check size={13} className="shrink-0 text-green-400" />
                  )}
                  {it.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => retryItem(it)}
                      className="flex shrink-0 items-center gap-1 text-[11px] text-red-400 transition hover:text-red-300"
                      title={it.errorMessage ?? "Nie udało się przesłać"}
                    >
                      <RotateCw size={12} /> Ponów
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={finish}
                disabled={!allDone}
                className="rounded-lg bg-accent-grad px-4 py-1.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
              >
                Gotowe
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
