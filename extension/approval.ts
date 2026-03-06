type ApprovalResponse = {
  ok: boolean;
  approval: {
    requestId: string;
    origin: string;
    chainId: string;
    address: string;
    message: string;
  } | null;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function showError(message: string): void {
  const el = $('approval-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

function setBusy(isBusy: boolean): void {
  const approve = $('btn-approve') as HTMLButtonElement;
  const reject = $('btn-reject') as HTMLButtonElement;
  approve.disabled = isBusy;
  reject.disabled = isBusy;
}

function parseRequestId(): string {
  return new URLSearchParams(window.location.search).get('requestId') ?? '';
}

async function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function resolveApproval(requestId: string, approved: boolean): Promise<void> {
  await sendRuntimeMessage({ type: 'RESOLVE_SIGN_APPROVAL', requestId, approved });
  window.close();
}

async function main(): Promise<void> {
  const requestId = parseRequestId();
  if (!requestId) {
    showError('Missing approval request id.');
    setBusy(true);
    return;
  }

  const response = await sendRuntimeMessage<ApprovalResponse>({
    type: 'GET_SIGN_APPROVAL',
    requestId,
  });

  if (!response.ok || !response.approval) {
    showError('This signing request is no longer available.');
    setBusy(true);
    return;
  }

  $('approval-origin').textContent = response.approval.origin;
  $('approval-chain').textContent = response.approval.chainId;
  $('approval-address').textContent = response.approval.address;
  $('approval-message').textContent = response.approval.message;

  $('btn-approve').addEventListener('click', async () => {
    setBusy(true);
    try {
      await resolveApproval(requestId, true);
    } catch (error) {
      setBusy(false);
      showError(error instanceof Error ? error.message : 'Failed to approve request.');
    }
  });

  $('btn-reject').addEventListener('click', async () => {
    setBusy(true);
    try {
      await resolveApproval(requestId, false);
    } catch (error) {
      setBusy(false);
      showError(error instanceof Error ? error.message : 'Failed to reject request.');
    }
  });
}

main().catch((error) => {
  showError(error instanceof Error ? error.message : 'Failed to load signing request.');
  setBusy(true);
});
