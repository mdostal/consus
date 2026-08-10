import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocEditorView } from './DocEditorView';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('DocEditorView', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    // mock alert to prevent errors
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderWithRouter(route = '/docs/my-repo/my/path/to/doc.md') {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/docs/:repo/*" element={<DocEditorView />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders loading state while fetching doc content', () => {
    (global.fetch as any).mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithRouter();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('fetches doc via GET and textarea displays fetched content', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'Hello World' }),
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/docs/content?repo=my-repo&path=my/path/to/doc.md');
    expect(screen.getByRole('textbox')).toHaveValue('Hello World');
  });

  it('Save button calls PUT /api/docs/content with modified text and commit_to_disk checkbox controls request payload', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'Initial Content' }),
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('Initial Content');
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ edit_id: '123' }),
    });

    // Modify text
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Content' } });

    // Click checkbox
    fireEvent.click(screen.getByLabelText('Commit to disk'));

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/docs/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo: 'my-repo',
          path: 'my/path/to/doc.md',
          content: 'New Content',
          commit_to_disk: true,
        }),
      });
    });
    
    expect(global.alert).toHaveBeenCalledWith('Saved!');
  });

  it('Fire button calls POST /api/docs/:edit_id/fire and shows ticket URL', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'Initial Content' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ edit_id: 'edit-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket_url: 'http://example.com/ticket/123' }),
      });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    // Fire button should be disabled initially
    expect(screen.getByText('Fire')).toBeDisabled();

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Fire')).not.toBeDisabled();
    });

    // Click Fire
    fireEvent.click(screen.getByText('Fire'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/docs/edit-123/fire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_repo: 'my-repo', actor: 'mathew' }),
      });
    });

    expect(screen.getByText('http://example.com/ticket/123')).toBeInTheDocument();
  });

  it('handles error states gracefully (fetch/save/fire failures)', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter();
    
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
