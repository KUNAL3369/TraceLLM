import { useState, useEffect, useCallback } from "react";

const steps = [
  {
    title: "Welcome to TraceLLM",
    description: "Your AI observability platform. Monitor, debug, and optimize your LLM calls across all providers.",
    icon: "🚀",
  },
  {
    title: "Create a Project",
    description: "Projects group your LLM usage. Each project gets a unique API key for the SDK.",
    icon: "📁",
    action: "/projects",
  },
  {
    title: "Integrate the SDK",
    description: "Wrap your LLM calls with the TraceLLM SDK to start capturing telemetry automatically.",
    icon: "🔌",
  },
  {
    title: "Monitor in Real-Time",
    description: "Watch metrics appear live on your dashboard — latency, tokens, errors, and costs.",
    icon: "📊",
    action: "/",
  },
  {
    title: "Set Up Alerts",
    description: "Get notified via Slack, email, or webhook when things go wrong.",
    icon: "🔔",
    action: "/alerts",
  },
];

const ONBOARDING_KEY = "tracellm-onboarding-complete";

export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) {
      setVisible(true);
    }
  }, []);

  // Separate effect for dismissal
  const dismiss = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setVisible(false);
    onComplete?.();
  }, [onComplete]);

  if (!visible) return null;

  const current = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1e293b] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mb-3 text-5xl">{current.icon}</div>
          <div className="mb-1 flex justify-center gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  i === step ? "bg-blue-400" : "bg-gray-600"
                }`}
              />
            ))}
          </div>
          <h2 className="mt-3 text-xl font-bold text-white">{current.title}</h2>
          <p className="mt-2 text-sm text-gray-400">{current.description}</p>
        </div>

        <div className="flex justify-between gap-3">
          <button
            onClick={dismiss}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:text-white"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step < steps.length - 1) {
                  setStep((s) => s + 1);
                } else {
                  dismiss();
                }
              }}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {step < steps.length - 1 ? "Next" : "Get Started"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
