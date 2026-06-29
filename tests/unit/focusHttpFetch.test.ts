import { describe, it, expect, vi } from 'vitest';
import { makeFocusHttpFetch, type RpcClient } from '../../supabase/functions/_shared/focusHttpFetch.ts';

function mockClient(result: { data?: unknown; error?: { message: string } | null }): {
  client: RpcClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as RpcClient, rpc };
}

describe('makeFocusHttpFetch', () => {
  it('maps a GET to the focus_http_request RPC and back to a Response', async () => {
    const { client, rpc } = mockClient({
      data: { status: 200, headers: [{ field: 'Content-Type', value: 'text/html' }], body: '<html>ok</html>' },
    });
    const fetchFn = makeFocusHttpFetch(client);

    const res = await fetchFn('https://mfprod-1.myfocuspos.com/ReportServer');

    expect(rpc).toHaveBeenCalledWith('focus_http_request', {
      p_url: 'https://mfprod-1.myfocuspos.com/ReportServer',
      p_method: 'GET',
      p_headers: {},
      p_body: null,
    });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('<html>ok</html>');
  });

  it('passes method, headers and body through (GET vs POST)', async () => {
    const { client, rpc } = mockClient({ data: { status: 200, headers: [], body: '' } });
    const fetchFn = makeFocusHttpFetch(client);

    await fetchFn('https://my.focuspos.com/Login.aspx', {
      method: 'post',
      headers: { Cookie: 'ASP.NET_SessionId=abc', 'User-Agent': 'EasyShiftHQ-Focus/1.0' },
      body: '__VIEWSTATE=xyz&user=sample',
    });

    expect(rpc).toHaveBeenCalledWith('focus_http_request', {
      p_url: 'https://my.focuspos.com/Login.aspx',
      p_method: 'POST',
      p_headers: { Cookie: 'ASP.NET_SessionId=abc', 'User-Agent': 'EasyShiftHQ-Focus/1.0' },
      p_body: '__VIEWSTATE=xyz&user=sample',
    });
  });

  it('surfaces status, headers.get (case-insensitive) and getSetCookie() for the cookie jar', async () => {
    const { client } = mockClient({
      data: {
        status: 302,
        headers: [
          { field: 'Location', value: '/Reports/NFocus.aspx' },
          { field: 'Set-Cookie', value: 'AuthCookie=tok; path=/' },
          { field: 'Set-Cookie', value: 'MyMenu=blob; path=/' },
        ],
        body: '',
      },
    });
    const res = await makeFocusHttpFetch(client)('https://my.focuspos.com/Login.aspx', { method: 'POST' });

    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(res.headers.get('location')).toBe('/Reports/NFocus.aspx'); // case-insensitive
    // Both Set-Cookie headers returned (loginToPortal needs all of them)
    const setCookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(setCookies).toEqual(['AuthCookie=tok; path=/', 'MyMenu=blob; path=/']);
  });

  it('normalises a Headers instance', async () => {
    const { client, rpc } = mockClient({ data: { status: 200, headers: [], body: '' } });
    const h = new Headers();
    h.set('Cookie', 'a=b');
    await makeFocusHttpFetch(client)('https://my.focuspos.com/x', { headers: h });

    expect(rpc.mock.calls[0][1].p_headers).toEqual({ cookie: 'a=b' });
  });

  it('throws when the RPC returns an error', async () => {
    const { client } = mockClient({ error: { message: 'refused url' } });
    await expect(makeFocusHttpFetch(client)('https://evil.example.com/x')).rejects.toThrow(
      /focus_http_request transport failed: refused url/,
    );
  });

  it('treats a null body in the RPC result as empty text', async () => {
    const { client } = mockClient({ data: { status: 204, headers: null, body: null } });
    const res = await makeFocusHttpFetch(client)('https://my.focuspos.com/x');
    expect(await res.text()).toBe('');
    expect((res.headers as Headers & { getSetCookie(): string[] }).getSetCookie()).toEqual([]);
  });
});
