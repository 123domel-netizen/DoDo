import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  createGallery,
  listStorageOrgsForConversation,
  MAX_GALLERY_ITEMS_PER_CALL,
  runGalleryUploadPipeline,
  uploadGalleryItem,
  type StorageOrgOption,
} from "@/lib/chat/galleryApi";
import { formatFileSize, prepareGalleryPhoto } from "@/lib/chat/upload";
import { galleryPerfReset } from "@/lib/chat/galleryUploadPerf";
import { setGalleryLocalThumb } from "@/lib/chat/galleryLocalThumbs";

interface GalleryCreateDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onCreated?: (galleryId: string, messageId: string | null) => void;
}

type Step = "form" | "uploading" | "done";

interface UploadItem {
  id: string;
  fileName: string;
  status: "pending" | "preparing" | "uploading" | "ready" | "failed";
  errorMessage?: string | null;
  /** Oryginał — do retry. */
  sourceFile: File;
}

/** Kreator galerii — karta w czacie pojawia się zaraz po utworzeniu; upload w tle (max 3). */
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
  const [prepProgress, setPrepProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const uploadRunningRef = useRef(false);

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
    setItems([]);
    setSubmitting(false);
    setPrepProgress(null);
    setOrgs(null);
    setOrgId(null);
    uploadRunningRef.current = false;
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
    const picked = Array.from(list).filter(
      (f) =>
        /^image\//i.test(f.type) ||
        /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name),
    );
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_GALLERY_ITEMS_PER_CALL));
  };

  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  };

  /** Można wrócić do czatu podczas uploadu — pipeline działa w tle. */
  const close = () => {
    if (submitting && step === "form") return;
    onClose();
  };

  const patchItem = (id: string, patch: Partial<UploadItem>) => {
    if (!mountedRef.current) return;
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
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
    setPrepProgress("Tworzenie galerii…");
    galleryPerfReset();
    try {
      // Twórz od razu z metadanymi oryginałów — prepare+upload w pipeline.
      const res = await createGallery({
        conversationId,
        orgId,
        title: cleanTitle,
        description: description.trim() || undefined,
        items: files.map((f) => ({
          fileName: f.name,
          mimeType: f.type || "image/jpeg",
          sizeBytes: f.size,
        })),
      });

      if (!mountedRef.current) return;
      if (res.error || !res.data) {
        setError(res.error || "Nie udało się utworzyć galerii.");
        setSubmitting(false);
        setPrepProgress(null);
        return;
      }

      const { gallery, items: galleryItems, messageId: newMessageId } = res.data;
      const nextItems: UploadItem[] = files.map((f, i) => {
        const id = galleryItems[i]?.id ?? `${gallery.id}-${i}`;
        setGalleryLocalThumb(gallery.id, id, f);
        return {
          id,
          fileName: f.name,
          status: "pending" as const,
          sourceFile: f,
        };
      });

      setGalleryId(gallery.id);
      setItems(nextItems);
      setStep("uploading");
      setSubmitting(false);
      setPrepProgress(null);

      // Karta w czacie od razu — nie czekamy na upload.
      onCreated?.(gallery.id, newMessageId ?? null);

      uploadRunningRef.current = true;
      const itemIds = nextItems.map((it) => it.id);
      void runGalleryUploadPipeline(gallery.id, files, itemIds, {
        onPrepareProgress: (done, total) => {
          if (mountedRef.current) {
            setPrepProgress(`Przygotowywanie… ${done}/${total}`);
          }
        },
        onItemStart: (itemId) => {
          patchItem(itemId, { status: "uploading", errorMessage: null });
        },
        onItemDone: (itemId, _index, result) => {
          if (result.ok) patchItem(itemId, { status: "ready", errorMessage: null });
          else patchItem(itemId, { status: "failed", errorMessage: result.error });
        },
      }).finally(() => {
        uploadRunningRef.current = false;
        if (mountedRef.current) {
          setPrepProgress(null);
          setStep("done");
        }
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Nie udało się utworzyć galerii.");
      setSubmitting(false);
      setPrepProgress(null);
    }
  };

  const retryItem = async (it: UploadItem) => {
    if (!galleryId) return;
    patchItem(it.id, { status: "uploading", errorMessage: null });
    try {
      const photo = await prepareGalleryPhoto(it.sourceFile);
      if (photo.thumb) setGalleryLocalThumb(galleryId, it.id, photo.thumb);
      const res = await uploadGalleryItem(galleryId, it.id, photo.main, photo.thumb, {
        fileName: photo.main.name,
        mimeType: photo.main.type || "image/jpeg",
        width: photo.width,
        height: photo.height,
        recompute: true,
      });
      if (res.error) patchItem(it.id, { status: "failed", errorMessage: res.error });
      else patchItem(it.id, { status: "ready", errorMessage: null });
    } catch (e) {
      patchItem(it.id, {
        status: "failed",
        errorMessage: e instanceof Error ? e.message : "Ponowienie nie powiodło się.",
      });
    }
  };

  const finish = () => {
    onClose();
  };

  const uploadedCount = items.filter((i) => i.status === "ready").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const inFlight = items.filter(
    (i) => i.status === "pending" || i.status === "preparing" || i.status === "uploading",
  ).length;
  const allDone = items.length > 0 && inFlight === 0;

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
                  accept="image/*,.heic,.heif"
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
                  {files.length} {files.length === 1 ? "zdjęcie" : "zdjęć"} · łącznie{" "}
                  {formatFileSize(files.reduce((s, f) => s + f.size, 0))}
                </div>
              )}
            </div>

            {error && <div className="mt-2.5 text-xs text-red-400">{error}</div>}
            {prepProgress && (
              <div className="mt-2.5 flex items-center gap-2 text-xs text-accent">
                <Loader2 size={13} className="animate-spin" />
                {prepProgress}
              </div>
            )}

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
                disabled={submitting || noStorageAvailable || !orgId || files.length === 0}
                onClick={() => void submit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                Wyślij
              </button>
            </div>
          </>
        )}

        {(step === "uploading" || step === "done") && (
          <>
            <div className="mb-2 text-xs text-ink-faint">
              {allDone
                ? failedCount > 0
                  ? `Gotowe · ${uploadedCount} ok · ${failedCount} nieudanych`
                  : `Gotowe · ${uploadedCount} zdjęć`
                : `Wysyłanie… ${uploadedCount}/${items.length}`}
              {prepProgress ? ` · ${prepProgress}` : ""}
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${items.length ? ((uploadedCount + failedCount) / items.length) * 100 : 0}%`,
                }}
              />
            </div>
            <ul className="thin-scrollbar max-h-56 space-y-1 overflow-y-auto text-[12px]">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center gap-2 rounded-md border border-line/60 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{it.fileName}</span>
                  {it.status === "ready" && <Check size={13} className="shrink-0 text-emerald-400" />}
                  {(it.status === "uploading" || it.status === "preparing" || it.status === "pending") && (
                    <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                  )}
                  {it.status === "failed" && (
                    <button
                      type="button"
                      title={it.errorMessage || "Ponów"}
                      onClick={() => void retryItem(it)}
                      className="inline-flex shrink-0 items-center gap-1 text-amber-400 hover:text-amber-300"
                    >
                      <RotateCw size={12} /> Ponów
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:border-line-strong hover:text-ink"
              >
                Wróć do czatu
              </button>
              {allDone && (
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
                >
                  Zamknij
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
