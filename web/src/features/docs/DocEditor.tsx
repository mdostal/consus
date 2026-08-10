import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchDocById, updateDoc, fireDoc, type DocDetails } from "../../api/docs";
import { DocRenderer } from "./DocRenderer";
import "../../theme/tokens.css";

export function DocEditor() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocDetails | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);
  const [isFiring, setIsFiring] = useState(false);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDocById(id!);
        if (mounted) {
          setDoc(data);
          setContent(data.content);
          setOriginalContent(data.content);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();

    return () => {
      mounted = false;
    };
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    try {
      await updateDoc(id, content);
      setOriginalContent(content);
      setMode("view");
      
      // refresh doc details (might have updated timestamp, etc)
      const data = await fetchDocById(id);
      setDoc(data);
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancel = () => {
    setContent(originalContent);
    setMode("view");
  };

  const handleFire = async () => {
    if (!id) return;
    setIsFiring(true);
    setFireError(null);
    try {
      const result = await fireDoc(id);
      setDoc((prev) => prev ? { 
        ...prev, 
        multica_issue_url: result.issueUrl, 
        multica_issue_id: result.issueId,
        fired_at: result.firedAt 
      } : prev);
    } catch (err) {
      setFireError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFiring(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!doc) return <div>Doc not found.</div>;

  return (
    <div className="doc-editor" style={{ maxWidth: "800px", margin: "0 auto", padding: "1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2>{doc.path}</h2>
          <div style={{ fontSize: "0.85em", color: "#666" }}>
            Repo: {doc.repo} | Epic: {doc.epic || "none"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {doc.multica_issue_url ? (
            <div style={{ fontSize: "0.9em" }}>
              <a href={doc.multica_issue_url} target="_blank" rel="noreferrer">
                Issue Link
              </a>
              {" "} (Fired on {new Date(doc.fired_at!).toLocaleString()})
            </div>
          ) : null}

          {mode === "view" && (
            <>
              <button onClick={() => setMode("edit")}>Edit</button>
              <button onClick={handleFire} disabled={isFiring}>
                {isFiring ? "Firing..." : "Fire"}
              </button>
            </>
          )}
        </div>
      </header>

      {fireError && (
        <div style={{ color: "red", marginBottom: "1rem" }}>
          Failed to fire: {fireError}
        </div>
      )}

      {mode === "edit" ? (
        <div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ width: "100%", minHeight: "400px", fontFamily: "monospace", padding: "0.5rem" }}
          />
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button onClick={handleSave}>Save</button>
            <button onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ border: "1px solid #ddd", padding: "1rem", borderRadius: "4px" }}>
          <DocRenderer format={doc.format} content={content} />
        </div>
      )}
    </div>
  );
}
