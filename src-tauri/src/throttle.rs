use std::time::{Duration, Instant};

/// Lets something through at most once per `every`.
pub struct Throttle {
    every: Duration,
    last: Option<Instant>,
}

impl Throttle {
    pub const fn new(every: Duration) -> Self {
        Self { every, last: None }
    }

    pub fn ready(&mut self, now: Instant) -> bool {
        if self
            .last
            .is_some_and(|last| now.duration_since(last) < self.every)
        {
            return false;
        }
        self.last = Some(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lets_the_first_call_through_then_waits_out_the_window() {
        let mut t = Throttle::new(Duration::from_millis(250));
        let start = Instant::now();
        assert!(t.ready(start));
        assert!(!t.ready(start + Duration::from_millis(249)));
        assert!(t.ready(start + Duration::from_millis(250)));
        assert!(!t.ready(start + Duration::from_millis(300)));
        assert!(t.ready(start + Duration::from_millis(600)));
    }
}
