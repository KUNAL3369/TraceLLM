import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f172a] px-4">
          <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-900/20 p-8 text-center">
            <div className="mb-4 text-5xl">⚠️</div>
            <h1 className="mb-2 text-xl font-bold text-white">Something went wrong</h1>
            <p className="mb-4 text-sm text-gray-400">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <details className="mb-4 text-left">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">Error details</summary>
              <pre className="mt-2 overflow-auto rounded bg-[#0f172a] p-3 text-xs text-red-400">
                {this.state.error?.message}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
