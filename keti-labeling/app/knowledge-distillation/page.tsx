"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Brain } from "lucide-react";
import MainHeader from "@/components/main-header";

export default function KnowledgeDistillationPage() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const savedDarkMode = localStorage.getItem("darkMode") === "true";
    setIsDarkMode(savedDarkMode);
    if (savedDarkMode) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("darkMode", isDarkMode.toString());
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MainHeader isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">Knowledge Distillation</h2>
            <p className="text-sm text-muted-foreground">
              YOLOv8-based lightweight model training and mAP@0.7 validation
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                Knowledge Distillation Console
              </CardTitle>
              <CardDescription>
                Train a lightweight model using datasets generated from Cold-start Labeling
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-muted/50 rounded-lg border">
                <div className="space-y-1">
                  <h4 className="font-medium">Ready to train?</h4>
                  <p className="text-sm text-muted-foreground">
                    Ensure your dataset is labeled before starting a Knowledge Distillation job.
                  </p>
                </div>
                <Link href="/training">
                  <Button>
                    Open Distillation Console
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Phase 2 Overview</CardTitle>
              <CardDescription>
                Knowledge Distillation Stage Details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Purpose</h4>
                  <p className="text-sm text-muted-foreground">
                    Compress LLM inference results into a model small enough for real-time on-site execution
                  </p>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Training Data</h4>
                  <p className="text-sm text-muted-foreground">
                    Images and their annotations (masks, bounding boxes, labels)
                  </p>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Performance Threshold</h4>
                  <p className="text-sm text-muted-foreground">
                    Production-ready when mAP@0.7 ≥ 0.7 is achieved
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid sm:grid-cols-2 gap-4">
            <Link href="/training">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="bg-primary/10 p-3 rounded-full mb-4">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-medium mb-2">Start Training</h3>
                  <p className="text-sm text-muted-foreground">
                    Start training a new YOLOv8 model
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/training/monitor">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="bg-primary/10 p-3 rounded-full mb-4">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-medium mb-2">Training Monitor</h3>
                  <p className="text-sm text-muted-foreground">
                    Monitor ongoing training jobs
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
