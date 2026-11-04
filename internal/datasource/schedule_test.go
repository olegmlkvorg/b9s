package datasource

import (
	"testing"
	"time"

	"github.com/vanderheijden86/b9s/pkg/model"
)

func TestApplySchedule_FillsStartedAndPlannedStart(t *testing.T) {
	db := openCreatorsDB(t,
		`CREATE TABLE issues (id TEXT, started_at DATETIME, metadata TEXT, close_reason TEXT)`,
		`INSERT INTO issues VALUES ('bd-1', '2026-11-04 07:45:04', '{"planned_start":"2026-11-05T09:00:00Z"}', 'superseded by bd-2'), ('bd-2', NULL, '{}', NULL), ('bd-3', NULL, 'not json', NULL)`,
	)
	issues := []model.Issue{{ID: "bd-1"}, {ID: "bd-2"}, {ID: "bd-3", Title: "kept"}}

	applySchedule(db, issues)

	if issues[0].StartedAt == nil || issues[0].StartedAt.UTC().Format(time.RFC3339) != "2026-11-04T07:45:04Z" {
		t.Errorf("bd-1 StartedAt = %v", issues[0].StartedAt)
	}
	if issues[0].PlannedStart == nil || issues[0].PlannedStart.Format(time.RFC3339) != "2026-11-05T09:00:00Z" {
		t.Errorf("bd-1 PlannedStart = %v", issues[0].PlannedStart)
	}
	if issues[0].CloseReason != "superseded by bd-2" || issues[1].CloseReason != "" {
		t.Errorf("CloseReason = %q, %q", issues[0].CloseReason, issues[1].CloseReason)
	}
	if issues[1].StartedAt != nil || issues[1].PlannedStart != nil || issues[2].PlannedStart != nil || issues[2].Title != "kept" {
		t.Errorf("bd-2/bd-3 should have no schedule: %+v %+v", issues[1], issues[2])
	}
}

func TestApplySchedule_SchemaWithoutColumns(t *testing.T) {
	db := openCreatorsDB(t, `CREATE TABLE issues (id TEXT)`, `INSERT INTO issues VALUES ('bd-1')`)
	issues := []model.Issue{{ID: "bd-1", Title: "kept"}}
	applySchedule(db, issues)
	if issues[0].StartedAt != nil || issues[0].Title != "kept" {
		t.Errorf("issue changed: %+v", issues[0])
	}
}

func TestPlannedStart_Layouts(t *testing.T) {
	for in, want := range map[string]string{
		`{"planned_start":"2026-11-05"}`:       "2026-11-05T00:00:00Z",
		`{"planned_start":"2026-11-05T09:30"}`: "2026-11-05T09:30:00Z",
	} {
		got := PlannedStart(in)
		if got == nil || got.Format(time.RFC3339) != want {
			t.Errorf("PlannedStart(%s) = %v, want %s", in, got, want)
		}
	}
	if PlannedStart(`{"planned_start":"soon"}`) != nil || PlannedStart("") != nil {
		t.Error("unreadable planned_start should be nil")
	}
}
