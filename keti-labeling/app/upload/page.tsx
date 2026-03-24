"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall, API_CONFIG } from "@/lib/api-config";
import DragDropUpload from "@/components/drag-drop-upload";
import MainHeader from "@/components/main-header";

export default function UploadPage() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const { toast } = useToast();

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

  const handleClassUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const classes = JSON.parse(e.target?.result as string);
        localStorage.setItem("ketilabel_classes", JSON.stringify(classes));
        setShowClassModal(false);
        toast({
          title: "Classes Uploaded",
          description: `Successfully loaded ${classes.length} classes.`,
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Invalid JSON",
          description: "Please check your file format.",
        });
      }
    };
    reader.readAsText(file);
  };

  const handleClassDownload = () => {
    const savedClasses = localStorage.getItem("ketilabel_classes");
    if (!savedClasses) {
      toast({
        variant: "destructive",
        title: "No classes found",
        description: "You haven't defined any classes yet.",
      });
      return;
    }

    try {
      const blob = new Blob([savedClasses], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "classes.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Classes Downloaded",
        description: "Your class definitions have been saved to classes.json",
      });
    } catch (error) {
      console.error("Failed to download classes:", error);
    }
  };

  const handleImageUpload = async (files: File[]) => {
    const uploadPromises = Array.from(files).map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await apiCall(API_CONFIG.ENDPOINTS.UPLOAD_IMAGE, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        return { success: true, filename: file.name };
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        return {
          success: false,
          filename: file.name,
          error: (error as Error).message,
        };
      }
    });

    const results = await Promise.all(uploadPromises);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      toast({
        title: "Upload Successful",
        description: `Successfully uploaded ${successful.length} images`,
      });
    }

    if (failed.length > 0) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: `Failed to upload ${failed.length} images`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MainHeader isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">Upload Resources</h2>
            <p className="text-sm text-muted-foreground">
              Add new images to your dataset or update class definitions.
            </p>
          </div>

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Image Upload</CardTitle>
                <CardDescription>
                  Drag and drop images or click to browse.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DragDropUpload
                  onUpload={handleImageUpload}
                  maxFiles={50}
                  maxSize={50 * 1024 * 1024}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Label Classes</CardTitle>
                <CardDescription>
                  Manage classification definitions for your project.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Dialog
                    open={showClassModal}
                    onOpenChange={setShowClassModal}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        <Upload className="mr-2 h-4 w-4" />
                        Upload JSON Configuration
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upload Class Configuration</DialogTitle>
                        <DialogDescription>
                          Upload a JSON file containing class definitions.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-xs font-medium mb-1.5">Format:</p>
                          <pre className="text-[10px] text-muted-foreground overflow-x-auto p-2 bg-background rounded border">
                            {`[
  { "id": "cat", "name": "Cat", "color": "#ff0000" },
  { "id": "dog", "name": "Dog", "color": "#00ff00" }
]`}
                          </pre>
                        </div>
                        <div>
                          <Label htmlFor="class-upload">Select File</Label>
                          <Input
                            id="class-upload"
                            type="file"
                            accept=".json"
                            onChange={handleClassUpload}
                            className="mt-1.5"
                          />
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleClassDownload}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
