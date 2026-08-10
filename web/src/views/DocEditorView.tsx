import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export function DocEditorView() {
  const { repo, '*': path } = useParams();  // Catch-all for path with slashes
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [commitToDisk, setCommitToDisk] = useState(false);
  const [ticketUrl, setTicketUrl] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContent();
  }, [repo, path]);

  async function fetchContent() {
    try {
      const res = await fetch(`/api/docs/content?repo=${repo}&path=${path}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      setContent(data.content);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit() {
    try {
      const res = await fetch('/api/docs/content', {
        method: 'PUT',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({repo, path, content, commit_to_disk: commitToDisk}),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      setEditId(data.edit_id);
      alert('Saved!');
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function fireTicket() {
    if (!editId) {alert('Save first!'); return;}
    try {
      const res = await fetch(`/api/docs/${editId}/fire`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({target_repo: repo, actor: 'mathew'}),
      });
      if (!res.ok) throw new Error('Fire failed');
      const data = await res.json();
      setTicketUrl(data.ticket_url);
    } catch (e: any) {
      alert(e.message);
    }
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="doc-editor">
      <h1>Edit {path}</h1>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={30}
        style={{width: '100%'}}
      />
      <div className="controls">
        <label>
          <input type="checkbox" checked={commitToDisk} onChange={e => setCommitToDisk(e.target.checked)} />
          Commit to disk
        </label>
        <button onClick={saveEdit}>Save</button>
        <button onClick={fireTicket} disabled={!editId}>Fire</button>
      </div>
      {ticketUrl && <div className="success">Ticket created: <a href={ticketUrl}>{ticketUrl}</a></div>}
    </div>
  );
}
