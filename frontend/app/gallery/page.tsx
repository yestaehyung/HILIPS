"use client";

import type React from "react";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiCall, API_CONFIG } from "@/lib/api-config";
import ImageGallery from "@/components/image-gallery";
import ImageGalleryFilter, { type FilterType } from "@/components/image-gallery-filter";
import LabelingWorkspace from "@/components/labeling-workspace";
import MainHeader from "@/components/main-header";
import BatchAutoLabelDialog from "@/components/batch-auto-label-dialog";
import CreateTestSetDialog from "@/components/create-test-set-dialog";
import WorkflowSummaryCard from "@/components/workflow-summary-card";
import ClassSetupOnboarding, { type ClassDefinition } from "@/components/class-setup-onboarding";
import { useWorkflowStatus } from "@/hooks/use-workflow-status";
import { Bot, Brain, Settings, FlaskConical, Shuffle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Experiment {
  experiment_id: string;
  name: string;
  created_at: string;
  current_iteration: number;
}

export default function Home() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadedClasses, setUploadedClasses] = useState<ClassDefinition[] | null>(null);
  const [galleryPage, setGalleryPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const { toast } = useToast();
  const [annotations, setAnnotations] = useState<Record<string, any[]>>({});
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [needsReviewImages, setNeedsReviewImages] = useState<string[]>([]);
  const [testSetImages, setTestSetImages] = useState<Record<string, string>>({});
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [testSetDialogOpen, setTestSetDialogOpen] = useState(false);
  
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [classes, setClasses] = useState<ClassDefinition[]>([]);
  
  const { summary: workflowSummary, loading: workflowLoading, startIteration } = useWorkflowStatus(15000);

  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const selectedExperiment = useMemo(() => {
    return experiments.find(e => e.experiment_id === selectedExperimentId) || null;
  }, [experiments, selectedExperimentId]);

  useEffect(() => {
    const savedDarkMode = localStorage.getItem("darkMode") === "true";
    setIsDarkMode(savedDarkMode);
    if (savedDarkMode) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  const fetchExperiments = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.EXPERIMENTS);
      if (response.ok) {
        const data = await response.json();
        setExperiments(data.experiments || []);
        
        const savedExpId = localStorage.getItem("hilips_current_experiment");
        if (savedExpId && data.experiments?.some((e: Experiment) => e.experiment_id === savedExpId)) {
          setSelectedExperimentId(savedExpId);
        }
      }
    } catch (error) {
      console.error("Failed to fetch experiments:", error);
    }
  }, []);

  const fetchTestSetImages = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.TEST_SETS_IMAGES);
      if (response.ok) {
        const data = await response.json();
        setTestSetImages(data.images || {});
      }
    } catch (error) {
      console.error("Failed to fetch test set images:", error);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
    fetchTestSetImages();
  }, [fetchExperiments, fetchTestSetImages]);

  useEffect(() => {
    if (selectedExperimentId) {
      localStorage.setItem("hilips_current_experiment", selectedExperimentId);
      setSessionId(`session_${Date.now()}`);
    } else {
      localStorage.removeItem("hilips_current_experiment");
      setSessionId(null);
    }
  }, [selectedExperimentId]);

  const handleCreateExperiment = async () => {
    const name = prompt("Enter experiment name:", `Experiment ${new Date().toLocaleDateString()}`);
    if (!name) return;

    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.EXPERIMENTS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        const data = await response.json();
        await fetchExperiments();
        setSelectedExperimentId(data.experiment?.experiment_id || data.experiment_id);
        toast({
          title: "Experiment Created",
          description: `Experiment "${name}" has been created.`,
        });
      } else {
        throw new Error("Failed to create experiment");
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to Create Experiment",
        description: "Please try again.",
      });
    }
  };

  useEffect(() => {
    const savedClasses = localStorage.getItem("hilips_classes");
    if (savedClasses) {
      try {
        const parsedClasses = JSON.parse(savedClasses);
        if (Array.isArray(parsedClasses) && parsedClasses.length > 0) {
          setClasses(parsedClasses);
          setUploadedClasses(parsedClasses);
          setShowOnboarding(false);
          return;
        }
      } catch (e) {
        console.error("Failed to parse saved classes:", e);
      }
    }
    setShowOnboarding(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("darkMode", isDarkMode.toString());
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  useEffect(() => {
    apiCall(API_CONFIG.ENDPOINTS.IMAGES)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load images");
        return res.json();
      })
      .then((data) => {
        setImages(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const convertCocoAnnotationsToPolygons = (annotations: any[], categories: any[] = []) => {
    const categoryMap: Record<number, string> = {};
    categories.forEach((cat: any) => {
      categoryMap[cat.id] = cat.name;
    });
    
    return annotations.map((ann: any, index: number) => {
      let segmentation: number[] = [];
      if (Array.isArray(ann.segmentation) && ann.segmentation.length > 0) {
        segmentation = Array.isArray(ann.segmentation[0]) 
          ? ann.segmentation[0] 
          : ann.segmentation;
      }
      
      return {
        id: `polygon-${ann.id || index}`,
        segmentation,
        bbox: ann.bbox || [],
        area: ann.area || 0,
        predicted_iou: ann.predicted_iou ?? ann.confidence,
        stability_score: ann.stability_score ?? ann.confidence,
        confidence: ann.confidence,
        label: categoryMap[ann.category_id] || `Object ${index + 1}`,
        visible: true,
        source: ann.source || (ann.auto_labeled ? "yolo" : undefined),
        needs_review: ann.needs_review,
      };
    });
  };

  const normalizePolygonData = (polygon: any, index: number): any => {
    const points = polygon.points || polygon.segmentation || [];
    
    let bbox = polygon.bbox;
    if ((!bbox || bbox.length === 0) && points.length >= 4) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        xs.push(points[i]);
        ys.push(points[i + 1]);
      }
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      bbox = [minX, minY, maxX - minX, maxY - minY];
    }

    return {
      ...polygon,
      id: polygon.id || `polygon-${index}`,
      segmentation: points,
      bbox: bbox || [],
      visible: polygon.visible !== undefined ? polygon.visible : true,
    };
  };

  const extractPolygonsFromPayload = (payload: any): any[] => {
    if (Array.isArray(payload?.polygons)) {
      return payload.polygons.map((p: any, i: number) => normalizePolygonData(p, i));
    }
    if (Array.isArray(payload?.data?.polygons)) {
      return payload.data.polygons.map((p: any, i: number) => normalizePolygonData(p, i));
    }
    
    if (Array.isArray(payload?.annotations)) {
      return convertCocoAnnotationsToPolygons(payload.annotations, payload.categories);
    }
    
    return [];
  };

  const resolveImageNameFromPayload = (payload: any, filename: string, imageList: string[]) => {
    const raw =
      payload?.image?.url ||
      payload?.image?.file_name ||
      payload?.image?.filename ||
      payload?.image?.name ||
      "";

    if (typeof raw === "string" && raw.trim().length > 0) {
      const parts = raw.trim().split("/");
      const fromPath = parts[parts.length - 1];
      if (fromPath) return fromPath;
    }

    if (filename.endsWith("_coco.json")) {
      const base = filename.replace(/_coco\.json$/i, "");
      const matched = imageList.find(
        (img) => img.replace(/\.[^/.]+$/, "") === base
      );
      if (matched) return matched;
      return `${base}.jpg`;
    }

    return filename;
  };

  const syncAnnotationsFromServer = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.ANNOTATIONS);
      if (!response.ok) {
        throw new Error(`Failed to load annotations: ${response.status}`);
      }
      const payload = await response.json().catch(() => null);

      let filenames: string[] = [];
      if (Array.isArray(payload)) {
        filenames = payload.filter(
          (item): item is string => typeof item === "string"
        );
      } else if (Array.isArray(payload?.files)) {
        filenames = payload.files
          .filter((item: any) => typeof item?.filename === "string")
          .map((item: any) => item.filename);
      }

      if (filenames.length === 0) {
        setAnnotations({});
        localStorage.removeItem("hilips_annotations");
        return;
      }

      const detailResults = await Promise.allSettled(
        filenames.map(async (name) => {
          const res = await apiCall(
            `${API_CONFIG.ENDPOINTS.ANNOTATIONS}/${encodeURIComponent(name)}`
          );
          if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
          const data = await res.json();
          return { filename: name, data };
        })
      );

      const nextAnnotations: Record<string, any[]> = {};

      detailResults.forEach((result) => {
        if (result.status !== "fulfilled") {
          console.error(result.reason);
          return;
        }

        const { filename, data } = result.value;
        const polygons = extractPolygonsFromPayload(data);

        if (!Array.isArray(polygons)) return;

        const imageName = resolveImageNameFromPayload(data, filename, images);
        if (!imageName) return;

        nextAnnotations[imageName] = polygons;
      });

      setAnnotations(nextAnnotations);
      if (Object.keys(nextAnnotations).length > 0) {
        localStorage.setItem(
          "hilips_annotations",
          JSON.stringify(nextAnnotations)
        );
      } else {
        localStorage.removeItem("hilips_annotations");
      }
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Failed to load annotations",
        description:
          error instanceof Error ? error.message : "Unexpected error occurred.",
      });
    }
  }, [toast, images]);

  useEffect(() => {
    const savedAnnotations = localStorage.getItem("hilips_annotations");
    if (savedAnnotations) {
      try {
        setAnnotations(JSON.parse(savedAnnotations));
      } catch (error) {
        console.error("Failed to load annotations:", error);
      }
    }
  }, []);

  useEffect(() => {
    syncAnnotationsFromServer();
  }, [syncAnnotationsFromServer]);

  const fetchLabelingStatus = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.LABELING_STATUS);
      if (response.ok) {
        const data = await response.json();
        setNeedsReviewImages(data.needs_review_images || []);
      }
    } catch (error) {
      console.error("Failed to fetch labeling status:", error);
    }
  }, []);

  useEffect(() => {
    fetchLabelingStatus();
  }, [fetchLabelingStatus]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const labeledImages = useMemo(() => {
    return images.filter((img) => 
      annotations[img]?.length > 0 && !needsReviewImages.includes(img)
    );
  }, [images, annotations, needsReviewImages]);

  const unlabeledImages = useMemo(() => {
    return images.filter((img) => 
      (!annotations[img] || annotations[img].length === 0) && !needsReviewImages.includes(img)
    );
  }, [images, annotations, needsReviewImages]);

  const testSetImageList = useMemo(() => Object.keys(testSetImages), [testSetImages]);

  const filteredImages = useMemo(() => {
    let result = images;

    switch (filterType) {
      case "labeled":
        result = labeledImages;
        break;
      case "unlabeled":
        result = unlabeledImages;
        break;
      case "needs-review":
        result = needsReviewImages.filter((img) => images.includes(img));
        break;
      case "test-set":
        result = images.filter((img) => testSetImages[img]);
        break;
      case "train-only":
        result = images.filter((img) => !testSetImages[img]);
        break;
      default:
        result = images;
    }

    return result.sort((a, b) => {
      if (sortOrder === "asc") {
        return a.localeCompare(b);
      } else {
        return b.localeCompare(a);
      }
    });
  }, [images, filterType, labeledImages, unlabeledImages, needsReviewImages, testSetImages, sortOrder]);

  const handleImageSelect = (image: string) => {
    setSelectedImage(image);
  };

  const handleOnboardingComplete = (newClasses: ClassDefinition[]) => {
    setClasses(newClasses);
    setUploadedClasses(newClasses);
    setShowOnboarding(false);
    toast({
      title: "Setup complete!",
      description: `${newClasses.length} classes configured. You're ready to start labeling.`,
    });
  };

  const handleStartLabeling = () => {
    if (unlabeledImages.length > 0) {
      setSelectedImage(unlabeledImages[0]);
    } else if (needsReviewImages.length > 0) {
      setSelectedImage(needsReviewImages[0]);
    } else if (images.length > 0) {
      setSelectedImage(images[0]);
    }
  };

  const handleBackToGallery = () => {
    setSelectedImage(null);
  };

  const handleNextImage = () => {
    if (!selectedImage) return;
    const currentIndex = filteredImages.indexOf(selectedImage);
    if (currentIndex < filteredImages.length - 1) {
      setSelectedImage(filteredImages[currentIndex + 1]);
    }
  };

  const handlePreviousImage = () => {
    if (!selectedImage) return;
    const currentIndex = filteredImages.indexOf(selectedImage);
    if (currentIndex > 0) {
      setSelectedImage(filteredImages[currentIndex - 1]);
    }
  };

  const hasNext = selectedImage
    ? filteredImages.indexOf(selectedImage) < filteredImages.length - 1
    : false;
  const hasPrevious = selectedImage
    ? filteredImages.indexOf(selectedImage) > 0
    : false;

  if (showOnboarding === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <ClassSetupOnboarding
        onComplete={handleOnboardingComplete}
        isDarkMode={isDarkMode}
      />
    );
  }

  if (selectedImage) {
    return (
      <LabelingWorkspace
        selectedImage={selectedImage}
        onBack={handleBackToGallery}
        uploadedClasses={uploadedClasses}
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        onNext={handleNextImage}
        onPrevious={handlePreviousImage}
        hasNext={hasNext}
        hasPrevious={hasPrevious}
        hasExistingAnnotations={
          !!(selectedImage && annotations[selectedImage] && annotations[selectedImage].length > 0)
        }
        initialAnnotations={selectedImage ? annotations[selectedImage] || [] : []}
        currentPhase={workflowSummary?.current_phase ?? 1}
        isTestSetImage={!!testSetImages[selectedImage]}
        onAnnotationsSave={(imageId, updatedPolygons) => {
          setAnnotations((prev) => {
            const next = { ...prev };
            if (!updatedPolygons || updatedPolygons.length === 0) {
              delete next[imageId];
            } else {
              next[imageId] = updatedPolygons;
            }
            return next;
          });
          fetchLabelingStatus();
        }}
        experimentId={selectedExperimentId || undefined}
        sessionId={sessionId || undefined}
        currentIteration={selectedExperiment?.current_iteration ?? 1}
      />
    );
  }

  const handleBatchComplete = async () => {
    await syncAnnotationsFromServer();
    await fetchLabelingStatus();
    toast({
      title: "Batch labeling complete",
      description: "Gallery has been refreshed with new annotations.",
    });
  };

  const handleStartTraining = async () => {
    if (!selectedExperimentId) {
      toast({
        variant: "destructive",
        title: "No Experiment Selected",
        description: "Please select an experiment before starting training.",
      });
      return;
    }

    const success = await startIteration(2);
    
    if (success && selectedExperimentId) {
      try {
        const response = await apiCall(`${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${selectedExperimentId}/iterations/start`, {
          method: "POST",
        });
        if (response.ok) {
          const data = await response.json();
          toast({
            title: "Iteration Started",
            description: `Started iteration ${data.iteration?.iteration || "new"}`,
          });
        } else {
          console.error("Failed to start experiment iteration:", response.status);
        }
      } catch (error) {
        console.error("Failed to start experiment iteration:", error);
      }
    }
    
    if (success) {
      window.location.href = "/training";
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MainHeader isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />

      <main className="container mx-auto px-4 py-6">
        <div className="space-y-6">
          <WorkflowSummaryCard 
            summary={workflowSummary} 
            loading={workflowLoading} 
            compact={true}
            onGoToLabeling={handleStartLabeling}
            onStartTraining={handleStartTraining}
          />

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Dataset Gallery</h2>
              <p className="text-sm text-muted-foreground">
                Manage and annotate your image dataset.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={selectedExperimentId || "none"}
                  onValueChange={(value) => {
                    if (value === "none") {
                      setSelectedExperimentId(null);
                    } else if (value === "new") {
                      handleCreateExperiment();
                    } else {
                      setSelectedExperimentId(value);
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue placeholder="Select experiment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No experiment</SelectItem>
                    <SelectItem value="new" className="text-primary font-medium">
                      + Create New Experiment
                    </SelectItem>
                    {experiments.map((exp) => (
                      <SelectItem key={exp.experiment_id} value={exp.experiment_id}>
                        {exp.name} (Iter {exp.current_iteration})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {workflowSummary && workflowSummary.queues.reviewed_since_last_train >= 10 && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => window.location.href = '/training'}
                  className="gap-2"
                >
                  <Brain className="h-4 w-4" />
                  Retrain ({workflowSummary.queues.reviewed_since_last_train} reviewed)
                </Button>
              )}
              {(workflowSummary?.current_phase ?? 1) >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchDialogOpen(true)}
                  disabled={unlabeledImages.length === 0}
                  className="gap-2"
                >
                  <Bot className="h-4 w-4" />
                  Auto-Label ({unlabeledImages.length})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTestSetDialogOpen(true)}
                className="gap-2"
              >
                <Shuffle className="h-4 w-4" />
                {testSetImageList.length > 0 ? `Test Set (${testSetImageList.length})` : "Create Test Set"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOnboarding(true)}
                className="gap-2"
                title="Configure classes"
              >
                <Settings className="h-4 w-4" />
                Classes ({classes.length})
              </Button>
              <Badge variant="outline" className="px-3 py-1">
                {images.length} Images
              </Badge>
            </div>
          </div>

          <ImageGalleryFilter
            onFilterChange={setFilterType}
            currentFilter={filterType}
            totalCount={images.length}
            labeledCount={labeledImages.length}
            unlabeledCount={unlabeledImages.length}
            needsReviewCount={needsReviewImages.length}
            testSetCount={testSetImageList.length}
          />

          <ImageGallery
            images={filteredImages}
            loading={loading}
            error={error}
            onImageSelect={handleImageSelect}
            annotations={annotations}
            testSetImages={testSetImages}
            currentPage={galleryPage}
            onPageChange={setGalleryPage}
          />
        </div>
      </main>

      <BatchAutoLabelDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        unlabeledCount={unlabeledImages.length}
        unlabeledImages={unlabeledImages}
        onComplete={handleBatchComplete}
      />

      <CreateTestSetDialog
        open={testSetDialogOpen}
        onOpenChange={setTestSetDialogOpen}
        totalImages={images.length}
        existingTestSetCount={testSetImageList.length}
        onComplete={() => {
          fetchTestSetImages();
        }}
      />
    </div>
  );
}
