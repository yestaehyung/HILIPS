"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ModelRegistryRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/models");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to Model Registry...</p>
    </div>
  );
}
