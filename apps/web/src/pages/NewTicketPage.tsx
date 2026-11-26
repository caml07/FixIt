import {
  ArrowLeft,
  FileImage,
  FileVideo,
  Info,
  MapPin,
  Monitor,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTickets, useToast } from "../app/providers";
import { PageHeader } from "../components/PageHeader";
import { categoryOptions } from "../lib/fixtures";
import type { TicketDraft, Urgency } from "../lib/types";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoType = "video/mp4";
const maxImage = 5 * 1024 * 1024;
const maxVideo = 25 * 1024 * 1024;
const maxTotal = 50 * 1024 * 1024;

const urgencyOptions: { value: Urgency; label: string; detail: string }[] = [
  { value: "LOW", label: "Low", detail: "Work can continue with a workaround." },
  { value: "NORMAL", label: "Normal", detail: "A task or service is disrupted." },
  { value: "HIGH", label: "High", detail: "A time-sensitive activity is blocked." },
];

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NewTicketPage() {
  const navigate = useNavigate();
  const { createTicket } = useTickets();
  const { showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categoryOptions[0]!.value);
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("NORMAL");
  const [location, setLocation] = useState("");
  const [equipment, setEquipment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function addFiles(incoming: File[]) {
    const combined = [...files, ...incoming];
    if (combined.length > 5) {
      showToast("A ticket can include up to five files.", "error");
      return;
    }
    if (combined.filter((file) => file.type === videoType).length > 2) {
      showToast("A ticket can include up to two videos.", "error");
      return;
    }
    for (const file of incoming) {
      const isImage = imageTypes.has(file.type);
      const isVideo = file.type === videoType;
      if (!isImage && !isVideo) {
        showToast(`${file.name} is not an accepted file type.`, "error");
        return;
      }
      if (isImage && file.size > maxImage) {
        showToast(`${file.name} is larger than 5 MiB.`, "error");
        return;
      }
      if (isVideo && file.size > maxVideo) {
        showToast(`${file.name} is larger than 25 MiB.`, "error");
        return;
      }
    }
    if (combined.reduce((total, file) => total + file.size, 0) > maxTotal) {
      showToast("The combined file size cannot exceed 50 MiB.", "error");
      return;
    }
    setFiles(combined);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const draft: TicketDraft = {
      title: title.trim(),
      category,
      description: description.trim(),
      urgency,
      location: location.trim() || undefined,
      equipment: equipment.trim() || undefined,
    };
    try {
      const ticket = await createTicket(draft);
      showToast(`${ticket.reference} was added to the queue.`, "success");
      navigate(`/tickets/${ticket.id}`);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The request could not be submitted.";
      setFormError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-content page-enter">
      <PageHeader
        title="New request"
        description="Tell the support team what is getting in the way. Add only the details that help them reproduce the issue."
        back={
          <Link className="back-link" to="/requests">
            <ArrowLeft size={15} />
            Back to my requests
          </Link>
        }
      />

      <form className="new-ticket-layout" onSubmit={handleSubmit}>
        <div className="new-ticket-form-column">
          <section className="form-section">
            <div className="form-section-heading">
              <span className="section-number">01</span>
              <div>
                <h2>Issue details</h2>
                <p>Start with a clear subject and the affected service.</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-field form-field-full">
                <label className="field-label" htmlFor="ticket-title">
                  Subject <span className="required-mark">*</span>
                </label>
                <input
                  className="text-input"
                  id="ticket-title"
                  maxLength={120}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Cannot connect to the shared drive"
                  required
                  value={title}
                />
                <span className="field-helper">
                  Keep it specific. This becomes the ticket title.
                </span>
              </div>
              <div className="form-field form-field-full">
                <label className="field-label" htmlFor="ticket-category">
                  Category <span className="required-mark">*</span>
                </label>
                <select
                  className="text-input select-input"
                  id="ticket-category"
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field form-field-full">
                <label className="field-label" htmlFor="ticket-description">
                  What happened? <span className="required-mark">*</span>
                </label>
                <textarea
                  className="text-input text-area"
                  id="ticket-description"
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe what you were trying to do, what happened instead, and any steps you have already tried."
                  required
                  rows={6}
                  value={description}
                />
                <div className="field-bottom-row">
                  <span className="field-helper">
                    Avoid including passwords or other sensitive information.
                  </span>
                  <span className="character-count">{description.length}/2000</span>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span className="section-number">02</span>
              <div>
                <h2>How urgent is it?</h2>
                <p>
                  Your assessment helps the team understand the impact. Support sets the
                  official priority.
                </p>
              </div>
            </div>
            <div
              className="urgency-options"
              role="radiogroup"
              aria-label="Proposed urgency"
            >
              {urgencyOptions.map((option) => (
                <label
                  className={`urgency-option ${urgency === option.value ? "urgency-option-selected" : ""}`}
                  key={option.value}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="urgency"
                    checked={urgency === option.value}
                    onChange={() => setUrgency(option.value)}
                    value={option.value}
                  />
                  <span
                    className={`urgency-option-dot urgency-dot-${option.value.toLowerCase()}`}
                  />
                  <span className="urgency-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                  <span className="urgency-radio-indicator" />
                </label>
              ))}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span className="section-number">03</span>
              <div>
                <h2>Evidence</h2>
                <p>Photos and short screen recordings can help explain the issue.</p>
              </div>
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag and drop supplements the accessible browse button */}
            <div
              className="evidence-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <span className="evidence-icon">
                <Upload size={19} />
              </span>
              <div className="evidence-copy">
                <strong>
                  Drop files here or{" "}
                  <button
                    className="inline-button"
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    browse files
                  </button>
                </strong>
                <span>JPEG, PNG, WebP up to 5 MiB · MP4 up to 25 MiB</span>
              </div>
              <input
                accept="image/jpeg,image/png,image/webp,video/mp4"
                className="visually-hidden"
                multiple
                onChange={handleFileChange}
                ref={fileInput}
                type="file"
              />
            </div>
            {files.length ? (
              <ul className="selected-file-list">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    {file.type === videoType ? (
                      <FileVideo size={16} />
                    ) : (
                      <FileImage size={16} />
                    )}
                    <span>
                      <strong>{file.name}</strong>
                      <small>{formatBytes(file.size)}</small>
                    </span>
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="remove-file-button"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="preview-upload-note">
              <Info size={14} /> Files are selected locally in this preview. Upload
              storage is integrated by the Tickets service.
            </p>
          </section>

          <details className="optional-details">
            <summary>
              <span>
                <MapPin size={16} />
                Additional details (optional)
              </span>
              <span className="optional-details-hint">Location & equipment</span>
            </summary>
            <div className="form-grid optional-details-fields">
              <div className="form-field">
                <label className="field-label" htmlFor="ticket-location">
                  Location
                </label>
                <input
                  className="text-input"
                  id="ticket-location"
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Building, room, or area"
                  value={location}
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="ticket-equipment">
                  Equipment
                </label>
                <input
                  className="text-input"
                  id="ticket-equipment"
                  onChange={(event) => setEquipment(event.target.value)}
                  placeholder="Device or asset name"
                  value={equipment}
                />
              </div>
            </div>
          </details>

          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="form-actions">
            <Link className="button button-secondary" to="/requests">
              Cancel
            </Link>
            <button
              className="button button-primary"
              disabled={
                pending || title.trim().length < 5 || description.trim().length < 10
              }
              type="submit"
            >
              {pending ? "Submitting…" : "Submit request"}
              <ArrowLeft className="button-arrow-forward" size={16} />
            </button>
          </div>
        </div>

        <aside className="new-ticket-aside">
          <div className="aside-note-card">
            <span className="aside-note-icon">
              <Info size={17} />
            </span>
            <h3>What happens next?</h3>
            <ol className="next-steps-list">
              <li>
                <span>1</span>
                <div>
                  <strong>We receive your request</strong>
                  <small>
                    It enters the support queue with an automatic timestamp.
                  </small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>An agent takes ownership</strong>
                  <small>
                    The team reviews the impact and sets the official priority.
                  </small>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>You stay in the loop</strong>
                  <small>
                    Use the ticket conversation to share updates and answers.
                  </small>
                </div>
              </li>
            </ol>
          </div>
          <div className="aside-note-card aside-security-card">
            <Monitor size={18} />
            <div>
              <strong>Keep it technical</strong>
              <p>
                Include the device, app, error, and steps to reproduce. Never share your
                password.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
