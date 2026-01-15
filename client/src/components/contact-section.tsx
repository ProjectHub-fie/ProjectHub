import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Send, Mail, Phone, MapPin } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";

export default function ContactSection() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) {
      toast({
        title: "Captcha Required",
        description: "Please complete the Turnstile verification to send your message.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, captchaToken }),
      });

      if (response.ok) {
        toast({
          title: "Message Sent!",
          description: "Thank you for reaching out. We'll get back to you soon.",
        });
        setFormData({ name: "", email: "", subject: "", message: "" });
        setCaptchaToken(null);
      } else {
        const error = await response.json();
        throw new Error(error.message || "Failed to send message");
      }
    } catch (error: any) {
      toast({
        title: "Submission Failed",
        description: error.message || "Something went wrong. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";
  console.log('Turnstile site key status:', !!import.meta.env.VITE_TURNSTILE_SITE_KEY, 'using key:', siteKey);

  const contactInfo = [
    /*{
      icon: <Mail className="text-blue-400" />,
      label: "Email",
      value: "dev.projecthub.fie@gmail.com",
      color: "bg-blue-500/20"
    },*/
    {
      icon: <Phone className="text-emerald-400" />,
      label: "Phone",
      value: "+8801934843920",
      color: "bg-emerald-500/20"
    },
    {
      icon: <MapPin className="text-violet-400" />,
      label: "Location",
      value: "Barishal, Banglades",
      color: "bg-violet-500/20"
    }
  ];

  const availability = [
    { label: "Status", value: "Available", color: "bg-emerald-500/20 text-emerald-400" },
    { label: "Response Time", value: "Within 24 hours", color: "text-slate-400" },
    { label: "Timezone", value: "BST (GMT+6)", color: "text-slate-400" }
  ];

  return (
    <section id="contact" className="py-20 bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
              Get In Touch
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Ready to bring your project to life? Let's discuss how we can work together.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          
          {/* Contact Form */}
          <div className="bg-card p-8 rounded-2xl border border-border">
            <h3 className="text-2xl font-bold text-foreground mb-6">Send us a Message</h3>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="name" className="text-muted-foreground mb-2">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="bg-secondary border-border text-foreground placeholder-muted-foreground focus:border-primary"
                    placeholder="Your name"
                    required
                    data-testid="input-name"
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-muted-foreground mb-2">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="bg-secondary border-border text-foreground placeholder-muted-foreground focus:border-primary"
                    placeholder="your@email.com"
                    required
                    data-testid="input-email"
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="subject" className="text-muted-foreground mb-2">Subject</Label>
                <Input
                  id="subject"
                  name="subject"
                  type="text"
                  value={formData.subject}
                  onChange={handleInputChange}
                  className="bg-secondary border-border text-foreground placeholder-muted-foreground focus:border-primary"
                  placeholder="Project inquiry"
                  required
                  data-testid="input-subject"
                />
              </div>
              
              <div>
                <Label htmlFor="message" className="text-muted-foreground mb-2">Message</Label>
                <Textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  rows={6}
                  className="bg-secondary border-border text-foreground placeholder-muted-foreground focus:border-primary resize-none"
                  placeholder="Tell me about your project..."
                  required
                  data-testid="textarea-message"
                />
              </div>
              
              <div className="flex justify-center mb-4 min-h-[78px]">
                <Turnstile
                  siteKey={siteKey}
                  onSuccess={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => setCaptchaToken(null)}
                />
              </div>
              <Button
                type="submit"
                disabled={isSubmitting || !captchaToken}
                className="w-full bg-blue-200 text-primary-foreground py-4 rounded-lg font-medium hover:shadow-lg transition-all duration-300 hover:-translate-y-1 disabled:opacity-50"
                data-testid="button-submit-form"
              >
                <Send className="w-4 h-4 mr-2 " />
                {isSubmitting ? "Sending..." : "Send Message"}
              </Button>
            </form>
          </div>

          {/* Contact Info */}
          <div className="space-y-8">
            
            {/* Contact Methods */}
            <div className="bg-card p-8 rounded-2xl border border-border">
              <h3 className="text-2xl font-bold text-foreground mb-6">Contact Information</h3>
              
              <div className="space-y-6">
                {contactInfo.map((info, index) => (
                  <div key={index} className="flex items-center space-x-4" data-testid={`contact-info-${index}`}>
                    <div className={`${info.color} p-3 rounded-lg`}>
                      {info.icon}
                    </div>
                    <div>
                      <div className="text-foreground font-medium">{info.label}</div>
                      <div className="text-muted-foreground">{info.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Availability */}
            <div className="bg-card p-8 rounded-2xl border border-border">
              <h3 className="text-2xl font-bold text-foreground mb-6">Availability</h3>
              <div className="space-y-4">
                {availability.map((item, index) => (
                  <div key={index} className="flex items-center justify-between" data-testid={`availability-${index}`}>
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${item.color}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
